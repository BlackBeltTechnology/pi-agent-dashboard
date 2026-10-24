/**
 * ControlHost (add-craft-live-control D3–D6): method policy, save path stripping, agentPending, read-only
 * requests, save records, busy / late results, reply size, screenshot pipeline, malformed replies.
 * Test-plan #E9 #E10 #E11 #E12 #E13 #E8 #E6 #E15 #X6 (host side; the shim relay is in craft-shim.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CraftControlProfile } from "../../shared/app-profiles.js";
import { ERROR_MAX_BYTES, REPLY_MAX_BYTES } from "../../shared/control-protocol.js";
import { ControlHost, type ControlReply } from "../control-host.js";
import { encodeJpeg, pngSize, processScreenshot, SCREENSHOT_EDGES } from "../screenshot.js";

const PROFILE: CraftControlProfile = {
  kind: "page-api",
  global: "fakecraft",
  verifiedVersion: "1.0.0",
  allowedCommands: ["object.rectangle", "doc.save", "doc.read", "doc.export"],
  readOnlyCommands: ["doc.read"],
  saveCommands: ["doc.save", "doc.export"],
  saveParamNames: ["path"],
};

function make(over: { open?: boolean; profile?: CraftControlProfile | undefined; buildVersion?: string; unsaved?: boolean | "unknown" } = {}) {
  const posted: Array<{ id: number; method: string; params: unknown }> = [];
  const pending = vi.fn();
  const state = { open: over.open ?? true };
  const host = new ControlHost({
    profile: "profile" in over ? over.profile : PROFILE,
    label: "FakeCraft",
    buildVersion: over.buildVersion,
    maxBytes: 16 * 1024 * 1024,
    instanceId: "inst-1",
    postControl: (id, method, params) => posted.push({ id, method, params }),
    isOpen: () => state.open,
    snapshotState: () => ({ path: "docs/a.fake", unsaved: over.unsaved ?? false }),
    onPendingChange: pending,
  });
  host.setCaps({ shimVersion: 3, control: true });
  return { host, posted, pending, state };
}

/** Answer the most recent posted request. */
const answer = (h: ReturnType<typeof make>, r: { ok: unknown; result?: unknown; error?: unknown; code?: unknown }) =>
  h.host.onFrameResult({ id: h.posted.at(-1)?.id as number, ...r });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("E9 method policy", () => {
  it("forwards an allowlisted command and the read methods; ui.screenshot always asks for data", async () => {
    const h = make();
    const a = h.host.run("engine.execute", { command: "object.rectangle", params: { x: 1 } });
    expect(h.posted.at(-1)).toMatchObject({ method: "engine.execute", params: { command: "object.rectangle", params: { x: 1 } } });
    answer(h, { ok: true, result: { id: 4 } });
    expect(await a).toMatchObject({ ok: true, result: { id: 4 }, instance: "inst-1" });
    for (const m of ["document.inspect", "ui.inspect", "engine.commands"]) {
      void h.host.run(m, undefined);
      expect(h.posted.at(-1)?.method).toBe(m);
      answer(h, { ok: true, result: [] });
      await vi.advanceTimersByTimeAsync(0);
    }
    void h.host.run("ui.screenshot", { anything: 1 });
    expect(h.posted.at(-1)).toMatchObject({ method: "ui.screenshot", params: { data: true } });
  });

  it.each([
    ["a command off the allowlist", "engine.execute", { command: "file.open" }],
    ["an extra key", "engine.execute", { command: "object.rectangle", extra: 1 }],
    ["an array command", "engine.execute", { command: ["a", "b"] }],
    ["non-object params", "engine.execute", { command: "object.rectangle", params: [1] }],
    ["no params at all", "engine.execute", undefined],
    ["app.quit", "app.quit", {}],
    ["an unknown method", "engine.eval", { code: "1" }],
    ["ui.inspect with array params", "ui.inspect", [1]],
  ])("denies %s without posting to the frame", async (_n, method, params) => {
    const h = make();
    const r = await h.host.run(method, params);
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(h.posted).toHaveLength(0);
    expect(h.pending).not.toHaveBeenCalled();
  });

  it("host.state is answered by the host and never posted", async () => {
    const h = make();
    const r = await h.host.run("host.state", {});
    expect(r).toMatchObject({ ok: true, result: { path: "docs/a.fake", unsaved: false, saves: [], noSaveYet: true } });
    expect(h.posted).toHaveLength(0);
  });

  it("not open → not-ready; a control-less profile or a build ≠ verified → unsupported (naming Settings → Update)", async () => {
    expect(await make({ open: false }).host.run("ui.inspect", undefined)).toMatchObject({ ok: false, code: "not-ready" });
    const none = await make({ profile: undefined }).host.run("ui.inspect", undefined);
    expect(none).toMatchObject({ ok: false, code: "unsupported" });
    const old = await make({ buildVersion: "0.9.0" }).host.run("ui.inspect", undefined);
    expect(old).toMatchObject({ ok: false, code: "unsupported", error: expect.stringMatching(/1\.0\.0.*Settings → Update/) });
    const h = make();
    h.host.setCaps({ shimVersion: 2, control: false });
    expect(await h.host.run("ui.inspect", undefined)).toMatchObject({ ok: false, code: "unsupported" });
    expect(h.posted).toHaveLength(0);
  });

  it("claim status order: unsupported, not-ready, not-visible, eligible", () => {
    const h = make();
    expect(h.host.claimStatus(true, true)).toBe("eligible");
    expect(h.host.claimStatus(false, true)).toBe("not-visible");
    expect(h.host.claimStatus(true, false)).toBe("not-visible");
    h.state.open = false;
    expect(h.host.claimStatus(false, false)).toBe("not-ready");
    h.host.resetCaps();
    expect(h.host.claimStatus(true, true)).toBe("unsupported");
  });
});

describe("E10 save commands", () => {
  it("strips the save target params, flags the reply and numbers the save", async () => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "doc.save", params: { path: "/etc/x.svg", format: "svg" } });
    expect(h.posted.at(-1)?.params).toEqual({ command: "doc.save", params: { format: "svg" } });
    answer(h, { ok: true, result: { pending: "saveOptions" } });
    expect(await p).toMatchObject({ ok: true, saveRequested: true, saveSeq: 0, instance: "inst-1" });
  });

  it("saveSeq is the highest save number seen when the request STARTED", async () => {
    const h = make();
    h.host.beginSave();
    h.host.beginSave();
    const p = h.host.run("engine.execute", { command: "doc.save" });
    h.host.beginSave(); // arrives while the app is still answering
    answer(h, { ok: true, result: null });
    expect(await p).toMatchObject({ saveRequested: true, saveSeq: 2 });
  });
});

describe("E11 / E12 agentPending", () => {
  it("is set when a non-read-only request is FORWARDED, whatever the result", async () => {
    for (const how of ["ok", "app_error", "timeout"] as const) {
      const h = make();
      const p = h.host.run("engine.execute", { command: "object.rectangle" });
      expect(h.host.agentPending, how).toBe(true);
      expect(h.pending).toHaveBeenCalledTimes(1);
      if (how === "ok") answer(h, { ok: true, result: {} });
      else if (how === "app_error") answer(h, { ok: false, error: "boom" });
      else await vi.advanceTimersByTimeAsync(10_001);
      await p;
      expect(h.host.agentPending, how).toBe(true);
    }
  });

  it("a read-only command, document.inspect and host.state never mark the tab", async () => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "doc.read" });
    answer(h, { ok: true, result: 1 });
    await p;
    const q = h.host.run("document.inspect", undefined);
    answer(h, { ok: true, result: {} });
    await q;
    await h.host.run("host.state", {});
    expect(h.host.agentPending).toBe(false);
    expect(h.pending).not.toHaveBeenCalled();
  });

  it("an own-file save ack clears it only when no agent request succeeded after the save message", async () => {
    const h = make();
    const edit = async () => {
      const p = h.host.run("engine.execute", { command: "object.rectangle" });
      answer(h, { ok: true, result: {} });
      await p;
    };
    await edit();
    // save message arrives, no agent edit before the ack → clean
    let mark = h.host.saveMark();
    h.host.ownSaveAcked(mark);
    expect(h.host.agentPending).toBe(false);
    // an agent ok between the save message and the ack keeps it
    await edit();
    mark = h.host.saveMark();
    await edit();
    h.host.ownSaveAcked(mark);
    expect(h.host.agentPending).toBe(true);
    // a later own-file save with no agent edit after it → clean
    h.host.ownSaveAcked(h.host.saveMark());
    expect(h.host.agentPending).toBe(false);
  });

  it("an agent request still running at the ack keeps it", async () => {
    const h = make();
    const first = h.host.run("engine.execute", { command: "object.rectangle" });
    answer(h, { ok: true, result: {} });
    await first;
    const mark = h.host.saveMark();
    void h.host.run("engine.execute", { command: "object.rectangle" }); // forwarded after the save message, unanswered
    h.host.ownSaveAcked(mark);
    expect(h.host.agentPending).toBe(true);
  });
});

describe("E13 save records", () => {
  it("lists every save after sinceSeq with its outcome; pending while a dialog is open", async () => {
    const h = make();
    const state = async (sinceSeq: number) => ((await h.host.run("host.state", { sinceSeq })) as Extract<ControlReply, { ok: true }>).result as { saves: Array<Record<string, unknown>>; noSaveYet: boolean };
    for (let i = 0; i < 4; i++) h.host.endSave(h.host.beginSave(), "saved");
    const five = h.host.beginSave();
    expect((await state(4)).saves).toMatchObject([{ seq: 5, pending: true }]);
    h.host.endSave(five, "sibling");
    expect((await state(4)).saves).toMatchObject([{ seq: 5, pending: false, outcome: "sibling" }]);
    h.host.endSave(h.host.beginSave(), "conflict");
    const s = await state(4);
    expect(s.saves).toMatchObject([
      { seq: 5, outcome: "sibling" },
      { seq: 6, outcome: "conflict" },
    ]);
    expect(s.noSaveYet).toBe(false);
    const none = await state(6);
    expect(none).toMatchObject({ saves: [], noSaveYet: true });
  });

  it("reports the unsaved state and keeps the newest 50 records", async () => {
    const h = make({ unsaved: true });
    for (let i = 0; i < 60; i++) h.host.endSave(h.host.beginSave(), "saved");
    const r = (await h.host.run("host.state", {})) as Extract<ControlReply, { ok: true }>;
    expect((r.result as { unsaved: unknown }).unsaved).toBe(true);
    expect((r.result as { saves: unknown[] }).saves).toHaveLength(50);
  });
});

describe("E8 busy, timeout and late results", () => {
  const exec = (h: ReturnType<typeof make>) => h.host.run("engine.execute", { command: "object.rectangle" });

  it("a second request while one is in flight is busy", async () => {
    const h = make();
    void exec(h);
    expect(await exec(h)).toMatchObject({ ok: false, code: "busy" });
    expect(h.posted).toHaveLength(1);
  });

  it("after the 10 s timeout the instance stays busy until the late result arrives", async () => {
    const h = make();
    const p = exec(h);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toMatchObject({ ok: false, code: "timeout", error: expect.stringMatching(/outcome unknown/) });
    await vi.advanceTimersByTimeAsync(2_000); // t = 12 s
    expect(await exec(h)).toMatchObject({ code: "busy" });
    h.host.onFrameResult({ id: h.posted[0].id, ok: true, result: {} }); // the late answer
    const next = exec(h);
    expect(h.posted).toHaveLength(2);
    answer(h, { ok: true, result: {} });
    expect(await next).toMatchObject({ ok: true });
  });

  it("with no late result the instance is idle again after 30 s (t = 40 s)", async () => {
    const h = make();
    void exec(h);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await exec(h)).toMatchObject({ code: "busy" });
    await vi.advanceTimersByTimeAsync(2);
    void exec(h);
    expect(h.posted).toHaveLength(2);
  });

  it("a late ok of an edit marks the tab unsaved again", async () => {
    const h = make();
    const p = exec(h);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    h.host.ownSaveAcked(h.host.saveMark()); // the save looked clean
    expect(h.host.agentPending).toBe(false);
    h.host.onFrameResult({ id: h.posted[0].id, ok: true, result: {} });
    expect(h.host.agentPending).toBe(true);
  });

  it("host.state is exempt from busy", async () => {
    const h = make();
    void exec(h);
    expect(await h.host.run("host.state", {})).toMatchObject({ ok: true });
  });
});

describe("E6 reply size", () => {
  const run = async (reply: { ok: unknown; result?: unknown; error?: unknown }) => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "doc.read" });
    answer(h, reply);
    return p;
  };
  const wrap = (n: number) => "x".repeat(n - 2);

  it("a result of 192 KiB − 1 and 192 KiB passes; 192 KiB + 1 is reply_too_large", async () => {
    expect(await run({ ok: true, result: wrap(REPLY_MAX_BYTES - 1) })).toMatchObject({ ok: true });
    expect(await run({ ok: true, result: wrap(REPLY_MAX_BYTES) })).toMatchObject({ ok: true });
    expect(await run({ ok: true, result: wrap(REPLY_MAX_BYTES + 1) })).toMatchObject({ ok: false, code: "reply_too_large" });
  });

  it("an error of 2 KiB passes through; 2 KiB + 1 is truncated to 2 KiB and stays app_error", async () => {
    const ok = await run({ ok: false, error: "e".repeat(ERROR_MAX_BYTES) });
    expect(ok).toMatchObject({ ok: false, code: "app_error" });
    expect(ok.ok === false && Buffer.byteLength(ok.error)).toBe(ERROR_MAX_BYTES);
    const cut = await run({ ok: false, error: "e".repeat(ERROR_MAX_BYTES + 1) });
    expect(cut.ok === false && Buffer.byteLength(cut.error)).toBe(ERROR_MAX_BYTES);
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const wide = "é".repeat(REPLY_MAX_BYTES / 2); // 2 bytes each → exactly over once the quotes are added
    expect(await run({ ok: true, result: wide })).toMatchObject({ ok: false, code: "reply_too_large" });
  });
});

describe("X6 malformed replies", () => {
  it.each([
    ["ok:'yes'", { ok: "yes", result: 1 }],
    ["a cyclic result", (() => { const c: Record<string, unknown> = {}; c.self = c; return { ok: true, result: c }; })()],
  ])("%s → app_error, the value is not relayed", async (_n, reply) => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "doc.read" });
    answer(h, reply);
    const r = await p;
    expect(r).toMatchObject({ ok: false, code: "app_error" });
    expect(JSON.stringify(r)).not.toContain("self");
  });

  it("an app_error text from the frame is the tool's error; a shim 'unsupported' code becomes unsupported", async () => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "doc.read" });
    answer(h, { ok: false, code: "unsupported", error: "nope" });
    expect(await p).toMatchObject({ ok: false, code: "unsupported", error: expect.stringMatching(/Settings → Update/) });
  });

  it("engine.commands lists only the allowlisted commands, trimmed", async () => {
    const h = make();
    const p = h.host.run("engine.commands", undefined);
    answer(h, { ok: true, result: [{ id: "object.rectangle", label: "Rect", params: "{x}", enabled: true, ui: false, shortcut: "R" }, { id: "file.open", label: "Open", params: "{}", enabled: true }] });
    expect(await p).toMatchObject({ ok: true, result: [{ id: "object.rectangle", label: "Rect", params: "{x}", enabled: true }] });
  });

  it("dispose answers a running request not-open", async () => {
    const h = make();
    const p = h.host.run("engine.execute", { command: "object.rectangle" });
    h.host.dispose();
    expect(await p).toMatchObject({ ok: false, code: "not-open" });
  });
});

describe("E15 screenshot pipeline", () => {
  /** A PNG header (signature + IHDR) of the given size; the rest is filler. */
  function png(width: number, height: number): string {
    const b = new Uint8Array(40);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const v = new DataView(b.buffer);
    v.setUint32(16, width);
    v.setUint32(20, height);
    return btoa(String.fromCharCode(...b));
  }
  const raw = (w: number, h: number) => ({ width: w, height: h, pngBase64: png(w, h) });
  const deps = { maxRawBytes: 16 * 1024 * 1024 };

  it("reads the size from the header", () => {
    expect(pngSize(Uint8Array.from(atob(png(2560, 1600)), (c) => c.charCodeAt(0)))).toEqual({ width: 2560, height: 1600 });
    expect(pngSize(new Uint8Array(40))).toBeNull();
  });

  it("4001×4000 is refused before decoding; 4000×4000 is decoded", async () => {
    const encode = vi.fn(async (_p: Uint8Array, edge: number) => ({ bytes: new Uint8Array(1000), width: edge, height: edge }));
    const big = await processScreenshot(raw(4001, 4000), { ...deps, encode });
    expect(big).toMatchObject({ ok: false, message: expect.stringMatching(/16 megapixels/) });
    expect(encode).not.toHaveBeenCalled();
    expect(await processScreenshot(raw(4000, 4000), { ...deps, encode })).toMatchObject({ ok: true });
  });

  it("re-encodes 2560×1600 to a long edge ≤ 1280 within 192 KiB", async () => {
    const encode = vi.fn(async (_p: Uint8Array, edge: number) => ({ bytes: new Uint8Array(50_000), width: edge, height: Math.round(edge * 0.625) }));
    const r = await processScreenshot(raw(2560, 1600), { ...deps, encode });
    expect(r).toMatchObject({ ok: true, result: { mime: "image/jpeg", width: 1280, height: 800 } });
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("steps 1280 → 960 → 640 until it fits; noisy content may only fit at 640", async () => {
    const sizeAt: Record<number, number> = { 1280: 400_000, 960: 300_000, 640: 100_000 };
    const encode = vi.fn(async (_p: Uint8Array, edge: number) => ({ bytes: new Uint8Array(sizeAt[edge]), width: edge, height: edge / 2 }));
    const r = await processScreenshot(raw(2560, 1280), { ...deps, encode });
    expect(encode.mock.calls.map((c) => c[1])).toEqual([...SCREENSHOT_EDGES]);
    expect(r).toMatchObject({ ok: true, result: { width: 640 } });
  });

  it("still too large at 640 → refused, naming 640×400", async () => {
    const encode = vi.fn(async (_p: Uint8Array, edge: number) => ({ bytes: new Uint8Array(400_000), width: edge, height: Math.round(edge * 0.625) }));
    const r = await processScreenshot(raw(2560, 1600), { ...deps, encode });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/640×400/) });
  });

  it("a reply with no image, a non-PNG and an oversize raw image are refused", async () => {
    expect(await processScreenshot({ width: 1, height: 1 }, deps)).toMatchObject({ ok: false });
    expect(await processScreenshot({ pngBase64: btoa("not a png at all, just text bytes....") }, deps)).toMatchObject({ ok: false, message: expect.stringMatching(/not a PNG/) });
    expect(await processScreenshot(raw(10, 10), { maxRawBytes: 10 })).toMatchObject({ ok: false, message: expect.stringMatching(/file size limit/) });
  });

  it("through the host: ui.screenshot becomes a JPEG reply, or reply_too_large", async () => {
    const h = make();
    (h.host as unknown as { d: { screenshot: unknown } }).d.screenshot = { encode: async (_p: Uint8Array, edge: number) => ({ bytes: new Uint8Array(2000), width: edge, height: 10 }) };
    const p = h.host.run("ui.screenshot", undefined);
    answer(h, { ok: true, result: raw(2560, 1600) });
    expect(await p).toMatchObject({ ok: true, result: { mime: "image/jpeg", width: 1280 } });
    const q = h.host.run("ui.screenshot", undefined);
    answer(h, { ok: true, result: raw(5000, 5000) });
    expect(await q).toMatchObject({ ok: false, code: "reply_too_large" });
  });

  it("encodeJpeg uses createImageBitmap + OffscreenCanvas at the requested edge", async () => {
    const closed = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: closed })));
    const draw = vi.fn();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: draw };
        }
        async convertToBlob(o: { type: string; quality: number }) {
          expect(o).toEqual({ type: "image/jpeg", quality: 0.8 });
          return new Blob([new Uint8Array(123)]);
        }
      },
    );
    const out = await encodeJpeg(Uint8Array.from(atob(png(2560, 1600)), (c) => c.charCodeAt(0)), 1280);
    expect(out).toMatchObject({ width: 1280, height: 800 });
    expect(out.bytes.length).toBe(123);
    expect(draw).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
