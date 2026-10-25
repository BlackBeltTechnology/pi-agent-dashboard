// @vitest-environment jsdom
/**
 * Media projects in the host (change: add-craft-web-media-projects). Test-plan #F5 (media read gate),
 * #F6 (sequential delivery), #F7 (save restore point), plus the open ordering and the missing-media notice.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_ACK_TIMEOUT_MS } from "../frame-session.js";
import { CRAFT_WEB_APPS } from "../craft-apps-table.js";
import { __resetSaveTargetsForTests } from "../save-target-store.js";
import { type Mounted, advance, flush, makeFh, mountFrame, opens, saveResults, shimSend } from "./test-utils.js";

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const dec = (b: ArrayBuffer) => new TextDecoder().decode(b);

function project(paths: string[]): string {
  const items: Record<string, unknown> = {};
  paths.forEach((p, i) => {
    items[String(i + 1)] = { kind: { Media: { media: { File: { path: p } } } } };
  });
  return JSON.stringify({ format: "filmcraft.project", schema_version: 15, project: { name: "p", items } });
}
const pathsOf = (json: string): string[] =>
  Object.values(JSON.parse(json).project.items).map((i) => (i as { kind: { Media: { media: { File: { path: string } } } } }).kind.Media.media.File.path);

type RawReply = "ok" | 403 | 404 | "throw";
/** Stubs `fetch`: status ok for FilmCraft; `/api/file/raw` answered per `path` (default 404). */
function stubWorkspace(files: Record<string, RawReply>, log: string[] = []) {
  const fn = vi.fn(async (url: string) => {
    if (url.endsWith("/status")) return { ok: true, status: 200, json: async () => ({ apps: { filmcraft: { status: "ok" } } }) };
    if (url.startsWith("/api/file/raw")) {
      const p = new URL(url, "http://x").searchParams.get("path") ?? "";
      log.push(p);
      const r = files[p] ?? 404;
      if (r === "throw") throw new Error("net");
      if (r === "ok") return { ok: true, status: 200, headers: new Headers({ "content-length": "3" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, body: null };
      return { ok: false, status: r, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0), body: null };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const mediaMsgs = (m: Mounted) => m.post.mock.calls.map((c) => c[0] as { type: string; name: string; bytes: ArrayBuffer }).filter((p) => p.type === "open-media");
const ack = (m: Mounted, name: string) => shimSend(m.iframe, { type: "open-media-ack", name });

async function mountFilm(paths: string[], tabPath = "edit/story.fcproj") {
  const body = enc(project(paths));
  const fh = makeFh({ path: tabPath, snapshot: vi.fn(async () => ({ bytes: body.slice(0), size: body.byteLength, mtime: 1, sha1: "aa" })) as never, save: vi.fn(async () => ({ ok: true as const, path: tabPath, mtime: 2, sha1: "bb" })) as never });
  const m = await mountFrame({ app: CRAFT_WEB_APPS.filmcraft, fh });
  return m;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  __resetSaveTargetsForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#F5 media read gate", () => {
  it("delivers the 200, counts 403/404/network error as missing, and the open still completes with one notice", async () => {
    const log: string[] = [];
    stubWorkspace({ "edit/ok.mp4": "ok", "edit/forbidden.mp4": 403, "edit/nf.mp4": 404, "edit/net.mp4": "throw" }, log);
    const m = await mountFilm(["ok.mp4", "forbidden.mp4", "nf.mp4", "net.mp4"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    expect(mediaMsgs(m).map((x) => x.name)).toEqual(["ok.mp4"]);
    await ack(m, "ok.mp4");
    await flush();
    expect(log).toEqual(["edit/ok.mp4", "edit/forbidden.mp4", "edit/nf.mp4", "edit/net.mp4"]);
    const o = opens(m);
    expect(o).toHaveLength(1);
    expect(pathsOf(dec(o[0].bytes))).toEqual(["/files/ok.mp4", "forbidden.mp4", "nf.mp4", "net.mp4"]);
    expect(m.getByTestId("craft-media-missing").textContent).toMatch(/3/);
  });

  it("a path outside the project folder is never requested", async () => {
    const log: string[] = [];
    stubWorkspace({ "edit/a.mp4": "ok" }, log);
    const m = await mountFilm(["a.mp4", "../secret.txt", "/etc/passwd"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    await ack(m, "a.mp4");
    await flush();
    expect(log).toEqual(["edit/a.mp4"]);
    expect(m.getByTestId("craft-media-missing").textContent).toMatch(/2/);
  });

  it("no ack within the timeout: this and the remaining media stay offline, the project is still opened", async () => {
    stubWorkspace({ "edit/a.mp4": "ok", "edit/b.mp4": "ok" });
    const m = await mountFilm(["a.mp4", "b.mp4"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    expect(opens(m)).toHaveLength(0);
    await advance(MEDIA_ACK_TIMEOUT_MS);
    await flush();
    expect(pathsOf(dec(opens(m)[0].bytes))).toEqual(["a.mp4", "b.mp4"]);
    expect(m.getByTestId("craft-media-missing").textContent).toMatch(/2/);
  });
});

describe("#F6 sequential delivery", () => {
  it("one read and one open-media at a time, in project order; the project is last", async () => {
    const log: string[] = [];
    stubWorkspace({ "edit/a.mp4": "ok", "edit/b.mp4": "ok", "edit/c.mp4": "ok", "edit/d.mp4": "ok" }, log);
    const m = await mountFilm(["a.mp4", "b.mp4", "c.mp4", "d.mp4"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    for (const [i, name] of ["a.mp4", "b.mp4", "c.mp4", "d.mp4"].entries()) {
      expect(log.length, `reads before ack ${name}`).toBe(i + 1);
      expect(mediaMsgs(m).map((x) => x.name)).toEqual(["a.mp4", "b.mp4", "c.mp4", "d.mp4"].slice(0, i + 1));
      expect(opens(m)).toHaveLength(0);
      await advance(500); // a late ack must not release the next medium early
      expect(mediaMsgs(m)).toHaveLength(i + 1);
      await ack(m, name);
      await flush();
    }
    expect(mediaMsgs(m)).toHaveLength(4);
    expect(pathsOf(dec(opens(m)[0].bytes))).toEqual(["/files/a.mp4", "/files/b.mp4", "/files/c.mp4", "/files/d.mp4"]);
    const order = m.post.mock.calls.map((c) => (c[0] as { type: string }).type).filter((t) => t === "open" || t === "open-media");
    expect(order).toEqual(["open-media", "open-media", "open-media", "open-media", "open"]);
  });

  it("an ack for a different name is ignored", async () => {
    stubWorkspace({ "edit/a.mp4": "ok" });
    const m = await mountFilm(["a.mp4"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    await ack(m, "other.mp4");
    await flush();
    expect(opens(m)).toHaveLength(0);
    await ack(m, "a.mp4");
    await flush();
    expect(opens(m)).toHaveLength(1);
  });
});

describe("#F7 save restore point", () => {
  it("workspaceSave gets the original paths; an app-added /files path and an undelivered one stay as saved", async () => {
    stubWorkspace({ "edit/clips/a.mp4": "ok" });
    const m = await mountFilm(["clips/a.mp4", "gone/x.mp4"]);
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    await ack(m, "a.mp4");
    await flush();
    await shimSend(m.iframe, { type: "opened" });
    const saved = enc(project(["/files/a.mp4", "gone/x.mp4", "/files/unknown.mp4"]));
    await shimSend(m.iframe, { type: "save", suggestedName: "story.fcproj", bytes: saved });
    await flush();
    expect(m.fh.save).toHaveBeenCalledTimes(1);
    const sent = (m.fh.save as unknown as { mock: { calls: Array<[ArrayBuffer, unknown]> } }).mock.calls[0][0];
    expect(pathsOf(dec(sent))).toEqual(["clips/a.mp4", "gone/x.mp4", "/files/unknown.mp4"]);
    expect(saveResults(m).at(-1)).toMatchObject({ ok: true });
  });

  it("a rejected save leaves nothing written (the host's save refuses; the app is told)", async () => {
    stubWorkspace({ "edit/a.mp4": "ok" });
    const m = await mountFilm(["a.mp4"]);
    (m.fh.save as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async () => ({ ok: false, reason: "rejected", message: "not a project" }));
    await shimSend(m.iframe, { type: "ready" });
    await flush();
    await ack(m, "a.mp4");
    await flush();
    await shimSend(m.iframe, { type: "opened" });
    await shimSend(m.iframe, { type: "save", suggestedName: "story.fcproj", bytes: enc("not json") });
    await flush();
    expect(saveResults(m).at(-1)).toMatchObject({ ok: false, error: "rejected" });
    const sent = (m.fh.save as unknown as { mock: { calls: Array<[ArrayBuffer, unknown]> } }).mock.calls[0][0];
    expect(dec(sent)).toBe("not json"); // non-JSON bytes pass through untouched for the validator to refuse
  });
});
