// @vitest-environment jsdom
/**
 * Host protocol with a simulated shim (change: edit-office-in-pane-with-craft-web).
 * Test-plan: #E20 (dirty), #E21 (message acceptance), #X3 (readiness timeout + ?webgl retry),
 * #X4 (opened timeout), navigation loss, blocked toast, csp forwarding, navigate-blocked.
 */
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CraftAppProfile } from "../../shared/app-profiles.js";
import { OPENED_TIMEOUT_MS, READY_TIMEOUT_MS } from "../CraftFrame.js";
import { CRAFT_WEB_APPS, type CraftWebApp } from "../craft-apps-table.js";
import { advance, bytesOf, flush, makeFh, mountFrame, nonceOf, openDoc, opens, saveResults, shimSend, stubFetch } from "./test-utils.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ready → open", () => {
  it("posts open once, transferred, only after ready; nothing before", async () => {
    stubFetch({});
    const m = await mountFrame();
    expect(opens(m)).toHaveLength(0);
    await shimSend(m.iframe, { type: "ready" });
    const o = opens(m);
    expect(o).toHaveLength(1);
    expect(o[0].name).toBe("report.docx");
    expect(o[0].bytes.byteLength).toBe(8);
    const call = m.post.mock.calls.find((c) => (c[0] as { type: string }).type === "open") as unknown[];
    expect(call[1]).toBe("*");
    expect(call[2]).toEqual([o[0].bytes]);
    expect((call[0] as { nonce: string }).nonce).toBe(nonceOf(m.iframe));
  });

  it("a duplicate ready is a navigation: frame dropped, no second open", async () => {
    stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "ready" });
    expect(opens(m)).toHaveLength(1);
    expect(m.queryByTestId("craft-frame")).toBeNull();
    expect(m.getByTestId("craft-reloaded")).toBeTruthy();
  });
});

describe("E21 message acceptance", () => {
  it("only a message from the frame, with the nonce, of a known type, in shape, acts", async () => {
    stubFetch({});
    const m = await mountFrame();
    // wrong source (the top window), wrong nonce, unknown type, malformed save → ignored
    await shimSend(m.iframe, { type: "ready" }, { source: window });
    await shimSend(m.iframe, { type: "ready" }, { nonce: "deadbeef" });
    await shimSend(m.iframe, { type: "ready" }, { source: null });
    await shimSend(m.iframe, { type: "bogus" });
    await shimSend(m.iframe, { type: "save", suggestedName: 5, bytes: bytesOf(3) });
    expect(opens(m)).toHaveLength(0);
    expect(m.getByTestId("craft-frame-host").getAttribute("data-phase")).toBe("starting");
    // the valid one acts
    await shimSend(m.iframe, { type: "ready" });
    expect(opens(m)).toHaveLength(1);
    expect(m.getByTestId("craft-frame-host").getAttribute("data-phase")).toBe("opening");
  });

  it("another window posting a save with the right nonce is ignored (nothing saved)", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(4) }, { source: window });
    expect(m.fh.save).not.toHaveBeenCalled();
  });

  it("an oversize save never reaches props.save (acceptance is not a write path)", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(41 * 1024 * 1024) });
    expect(m.fh.save).not.toHaveBeenCalled();
  });

  it("a second opened is ignored", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "opened" });
    expect(m.getByTestId("craft-frame-host").getAttribute("data-phase")).toBe("open");
  });
});

describe("X3 readiness timeout", () => {
  it("no ready within 60 s → 'could not start' + Retry; frame removed", async () => {
    stubFetch({});
    const m = await mountFrame({ renderer: { gpu: true, webgl2: true } });
    await advance(READY_TIMEOUT_MS - 1);
    expect(m.queryByTestId("craft-start-failed")).toBeNull();
    await advance(1);
    expect(m.getByTestId("craft-start-failed").textContent).toContain("could not start");
    expect(m.queryByTestId("craft-frame")).toBeNull();
  });

  it("Retry after a WebGPU-path failure uses ?webgl with a fresh nonce", async () => {
    stubFetch({});
    const m = await mountFrame({ renderer: { gpu: true, webgl2: true } });
    const first = m.iframe.getAttribute("src");
    await advance(READY_TIMEOUT_MS);
    fireEvent.click(m.getByTestId("craft-start-failed-retry"));
    await flush();
    const next = m.getByTestId("craft-frame") as HTMLIFrameElement;
    expect(next.getAttribute("src")).toMatch(/index\.html\?webgl#n=/);
    expect(next.getAttribute("src")).not.toBe(first);
  });

  it("Retry without WebGL2 keeps the default path", async () => {
    stubFetch({});
    const m = await mountFrame({ renderer: { gpu: true, webgl2: false } });
    await advance(READY_TIMEOUT_MS);
    fireEvent.click(m.getByTestId("craft-start-failed-retry"));
    await flush();
    expect((m.getByTestId("craft-frame") as HTMLIFrameElement).getAttribute("src")).not.toContain("?webgl");
  });

  it("a ready that arrives in time cancels the timer", async () => {
    stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened" });
    await advance(READY_TIMEOUT_MS + OPENED_TIMEOUT_MS);
    expect(m.queryByTestId("craft-start-failed")).toBeNull();
    expect(m.queryByTestId("craft-open-failed")).toBeNull();
  });
});

describe("X4 opened timeout", () => {
  it("ready but no opened within 15 s → 'could not open'", async () => {
    stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await advance(OPENED_TIMEOUT_MS - 1);
    expect(m.queryByTestId("craft-open-failed")).toBeNull();
    await advance(1);
    expect(m.getByTestId("craft-open-failed").textContent).toContain("could not be opened");
    // Retry re-mounts a fresh frame (fresh snapshot, fresh nonce)
    fireEvent.click(m.getByTestId("craft-open-failed-retry"));
    await flush();
    expect(m.getByTestId("craft-frame")).toBeTruthy();
    expect(m.fh.snapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("E20 dirty derivation", () => {
  it("unknown → true → true → false; after a copy save it stays true", async () => {
    stubFetch({});
    const m = await mountFrame();
    const calls = () => m.fh.setDirty.mock.calls.map((c) => c[0]);
    expect(calls()).toEqual(["unknown"]);
    await openDoc(m);
    // no signal yet: still unknown (never a spurious false), even after 10 s
    await advance(10_000);
    expect(calls()).toEqual(["unknown"]);
    await shimSend(m.iframe, { type: "dirty", value: true });
    await shimSend(m.iframe, { type: "dirty", value: true });
    expect(calls()).toEqual(["unknown", true]);
    // save to the tab's own file → app reports clean → false
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(calls()).toEqual(["unknown", true, false]);
    // copy save: the tab's own file still lacks the edits → true, and clean signals don't clear it
    fireEvent.click(m.getByTestId("craft-save-target-copy"));
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(m.fh.save).toHaveBeenLastCalledWith(expect.anything(), { target: "copy" });
    expect(calls().at(-1)).toBe(true);
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(calls().at(-1)).toBe(true);
    // an overwrite save afterwards clears it
    fireEvent.click(m.getByTestId("craft-save-target-overwrite"));
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(5) });
    expect(calls().at(-1)).toBe(false);
  });

  it("a dirty message before the document is open is ignored", async () => {
    stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(m.fh.setDirty.mock.calls.map((c) => c[0])).toEqual(["unknown"]);
  });
});

describe("navigation / frame loss", () => {
  it("second frame load with unknown/dirty state → 'Unsaved edits were lost' + Resume; nothing more is sent", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "dirty", value: true });
    const before = m.post.mock.calls.length;
    fireEvent.load(m.iframe); // initial document
    expect(m.queryByTestId("craft-reloaded")).toBeNull();
    fireEvent.load(m.iframe); // navigation / reload
    await flush();
    expect(m.getByTestId("craft-reloaded").textContent).toContain("The editor reloaded. Unsaved edits were lost.");
    expect(m.queryByTestId("craft-frame")).toBeNull();
    expect(m.post.mock.calls.length).toBe(before);
    expect(m.fh.setDirty).toHaveBeenLastCalledWith(false);
  });

  it("when the last known state was clean → plain 'Editor reloaded'", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "dirty", value: false });
    fireEvent.load(m.iframe);
    fireEvent.load(m.iframe);
    await flush();
    expect(m.getByTestId("craft-reloaded").textContent).toBe("Editor reloadedResume");
  });

  it("Resume re-opens from disk: new frame, new nonce, fresh snapshot, one new open", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    const nonce1 = nonceOf(m.iframe);
    fireEvent.load(m.iframe);
    fireEvent.load(m.iframe);
    await flush();
    fireEvent.click(m.getByTestId("craft-reloaded-retry"));
    await flush();
    const f2 = m.getByTestId("craft-frame") as HTMLIFrameElement;
    expect(nonceOf(f2)).not.toBe(nonce1);
    const post2 = vi.spyOn(f2.contentWindow as Window, "postMessage");
    await shimSend(f2, { type: "ready" });
    expect(post2.mock.calls.filter((c) => (c[0] as { type: string }).type === "open")).toHaveLength(1);
  });

  it("messages from a dropped frame are ignored", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    const frame = m.iframe;
    fireEvent.load(frame);
    fireEvent.load(frame);
    await flush();
    await shimSend(frame, { type: "save", suggestedName: "report.docx", bytes: bytesOf(4) });
    expect(m.fh.save).not.toHaveBeenCalled();
  });
});

describe("blocked / csp / navigate-blocked", () => {
  it("blocked → toast 'Open other files from the dashboard'", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "blocked", what: "file-input" });
    expect(m.getByTestId("craft-blocked-toast").textContent).toBe("Open other files from the dashboard");
    await advance(7000);
    expect(m.queryByTestId("craft-blocked-toast")).toBeNull();
  });

  it("csp → POST csp-report {app, directive}, rate-limited per directive and overall", async () => {
    const f = stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    const posts = () => f.calls.filter((c) => c.url.endsWith("/csp-report"));
    await shimSend(m.iframe, { type: "csp", directive: "connect-src" });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0].body ?? "{}")).toEqual({ app: "wordcraft", directive: "connect-src" });
    for (let i = 0; i < 5; i++) await shimSend(m.iframe, { type: "csp", directive: "connect-src" });
    expect(posts()).toHaveLength(1);
    await shimSend(m.iframe, { type: "csp", directive: "script-src" });
    expect(posts()).toHaveLength(2);
    await advance(10_001);
    await shimSend(m.iframe, { type: "csp", directive: "connect-src" });
    expect(posts()).toHaveLength(3);
    // a flood of distinct directives is bounded
    for (let i = 0; i < 40; i++) await shimSend(m.iframe, { type: "csp", directive: `d${i}` });
    expect(posts().length).toBeLessThanOrEqual(20);
    // nothing is shown to the user
    expect(m.container.textContent).not.toContain("connect-src");
  });

  it("navigate-blocked → confirm offer; opening uses a noopener new tab; dismiss does nothing", async () => {
    stubFetch({});
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "navigate-blocked", url: "https://example.com/a?b=1" });
    expect(m.getByTestId("craft-nav-offer").textContent).toContain("https://example.com/a?b=1");
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(m.getByTestId("craft-nav-open"));
    expect(open).toHaveBeenCalledWith("https://example.com/a?b=1", "_blank", "noopener,noreferrer");
    expect(m.queryByTestId("craft-nav-offer")).toBeNull();
    // editor stays loaded
    expect(m.getByTestId("craft-frame")).toBeTruthy();
    await shimSend(m.iframe, { type: "navigate-blocked", url: "https://example.com/z" });
    fireEvent.click(m.getByTestId("craft-nav-dismiss"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("non-http(s) targets are never offered", async () => {
    stubFetch({});
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "navigate-blocked", url: "javascript:alert(1)" });
    expect(m.queryByTestId("craft-nav-open")).toBeNull();
    expect(m.getByTestId("craft-nav-offer").textContent).not.toContain("javascript");
    expect(open).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------
// Host v2 (change: extend-craft-web-to-all-apps, D2/D4/D11)
// ---------------------------------------------------------------------------------------------------

const WORD = CRAFT_WEB_APPS.wordcraft;
/** A synthetic claim row for an app profile (rows of later waves; the host is generic). */
function appRow(appId: string, label: string, claim: Partial<CraftWebApp>, profile: Partial<CraftAppProfile> = {}): CraftWebApp {
  return {
    ...WORD,
    id: appId,
    claimId: claim.claimId ?? appId,
    label,
    extensions: [".x"],
    mode: "edit",
    siblingExtensions: [],
    ...claim,
    profile: { ...WORD.profile, appId, label, ...profile },
  };
}
const CAD = appRow("cadcraft", "CADCraft", { extensions: [".dxf"] }, { title: undefined, openedFallbackMs: 3000, cleanOnAckedSave: true });
const PHOTO_RASTER = appRow("photocraft", "PhotoCraft", { claimId: "photocraft-raster", extensions: [".jpg"], siblingExtensions: [".psd"] });
const LIGHT = appRow("lightcraft", "LightCraft", { extensions: [".dng"], mode: "preview" }, { title: undefined, openedFallbackMs: 5000, frameParams: ["nosw"], workerTrampoline: true });
const statusFor = (...ids: string[]) => () => Object.fromEntries(ids.map((id) => [id, { status: "ok" }]));
const telemetry = (f: { calls: Array<{ url: string; body?: string }> }) =>
  f.calls.filter((c) => c.url.endsWith("/telemetry")).map((c) => JSON.parse(c.body as string) as Record<string, unknown>);

describe("E12 v1 compatibility of opened", () => {
  it("an opened without `confirmed` opens, counts as `title`, and the first overwrite goes straight to core", async () => {
    const f = stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "report" }); // v1 shim: no confirmed field
    expect(m.iframe.closest("[data-phase]")?.getAttribute("data-phase")).toBe("open");
    expect(telemetry(f)).toEqual([{ app: "wordcraft", kind: "open", outcome: "title" }]);
    await shimSend(m.iframe, { type: "save", suggestedName: "report.docx", bytes: bytesOf(3) });
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "overwrite" });
    expect(m.queryByTestId("craft-save-as")).toBeNull();
  });
});

describe("E28 unconfirmed open: one question (core's)", () => {
  it("opened{confirmed:false} → telemetry fallback; the first own save calls props.save directly, no plugin dialog", async () => {
    const f = stubFetch({ status: statusFor("cadcraft") });
    const m = await mountFrame({ app: CAD, fh: makeFh({ path: "plan.dxf", save: vi.fn(async () => ({ ok: true as const, path: "plan.dxf", mtime: 2, sha1: "b" })) as never }) });
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "plan.dxf", confirmed: false });
    expect(telemetry(f)).toEqual([{ app: "cadcraft", kind: "open", outcome: "fallback" }]);
    await shimSend(m.iframe, { type: "save", suggestedName: "plan.dxf", bytes: bytesOf(3) });
    expect(m.fh.save).toHaveBeenCalledTimes(1);
    expect(m.fh.save).toHaveBeenCalledWith(expect.anything(), { target: "overwrite" });
    expect(m.queryByTestId("craft-save-as")).toBeNull();
    expect(saveResults(m).at(-1)).toMatchObject({ ok: true, own: true });
  });

  it("core turning the overwrite into a copy (first-overwrite notice → Save as copy) is not an own save: stays dirty", async () => {
    stubFetch({ status: statusFor("cadcraft") });
    const save = vi.fn(async () => ({ ok: true as const, path: "plan.cadcraft.dxf", mtime: 2, sha1: "b" }));
    const m = await mountFrame({ app: CAD, fh: makeFh({ path: "plan.dxf", save: save as never }) });
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "plan.dxf", confirmed: false });
    await shimSend(m.iframe, { type: "dirty", value: true });
    await shimSend(m.iframe, { type: "save", suggestedName: "plan.dxf", bytes: bytesOf(3) });
    const r = saveResults(m).at(-1) as Record<string, unknown>;
    expect(r).toMatchObject({ ok: true });
    expect(r.own).toBeUndefined();
    expect(m.fh.setDirty.mock.calls.at(-1)?.[0]).toBe(true);
  });
});

describe("start-failed from the shim (D4)", () => {
  it("before opened → 'could not start' + Retry, telemetry start-failed, the open is never resent", async () => {
    const f = stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    expect(opens(m)).toHaveLength(1);
    await shimSend(m.iframe, { type: "start-failed", detail: "panicked at …" });
    expect(m.getByTestId("craft-start-failed")).toBeTruthy();
    expect(m.queryByTestId("craft-frame")).toBeNull();
    expect(opens(m)).toHaveLength(1);
    expect(telemetry(f)).toEqual([{ app: "wordcraft", kind: "open", outcome: "start-failed" }]);
  });

  it("after opened → ignored", async () => {
    stubFetch({});
    const m = await mountFrame();
    await openDoc(m);
    await shimSend(m.iframe, { type: "start-failed" });
    expect(m.queryByTestId("craft-start-failed")).toBeNull();
    expect(m.getByTestId("craft-frame")).toBeTruthy();
  });

  it("an open timeout is reported as `timeout`", async () => {
    const f = stubFetch({});
    const m = await mountFrame();
    await shimSend(m.iframe, { type: "ready" });
    await advance(OPENED_TIMEOUT_MS + 1);
    expect(telemetry(f)).toEqual([{ app: "wordcraft", kind: "open", outcome: "timeout" }]);
  });
});

describe("E25 frame flags invariant", () => {
  it("every shipped claim: sandbox allow-scripts, allow clipboard-write; profile frameParams only in the src query", async () => {
    for (const app of [...Object.values(CRAFT_WEB_APPS), LIGHT]) {
      stubFetch({ status: statusFor(app.id) });
      const m = await mountFrame({ app, fh: makeFh({ path: `f${app.extensions[0]}` }) });
      expect(m.iframe.getAttribute("sandbox")).toBe("allow-scripts");
      expect(m.iframe.getAttribute("allow")).toBe("clipboard-write");
      const src = m.iframe.getAttribute("src") as string;
      const query = /\?([^#]*)/.exec(src)?.[1] ?? "";
      for (const flag of app.profile.frameParams ?? []) expect(query.split("&")).toContain(flag);
      expect(src.split("#")[1]).toMatch(/^n=[0-9a-f]+$/);
      cleanup();
    }
  });

  it("nosw with the WebGL path: both flags in the query, no document data in the URL", async () => {
    stubFetch({ status: statusFor("lightcraft") });
    const m = await mountFrame({ app: LIGHT, fh: makeFh({ path: "sample.dng" }), renderer: { gpu: false, webgl2: true } });
    const src = m.iframe.getAttribute("src") as string;
    expect(src).toMatch(/^\/apps\/craft-lightcraft\/index\.html\?nosw&webgl#n=[0-9a-f]+$/);
    expect(src).not.toContain("sample");
  });
});

describe("E30 toolbar states where saves go (B2/B3)", () => {
  it("plain edit claim: no chip, label 'Save target'", async () => {
    stubFetch({ status: statusFor("cadcraft") });
    const m = await mountFrame({ app: CAD, fh: makeFh({ path: "plan.dxf" }) });
    expect(m.queryByTestId("craft-sibling-chip")).toBeNull();
    expect(m.queryByTestId("craft-preview-chip")).toBeNull();
    expect(m.getByTestId("craft-save-target-label").textContent).toBe("Save target");
  });

  it("edit claim with siblingExtensions: chip names the created file, label 'Exports to .jpg', toggle present", async () => {
    stubFetch({ status: statusFor("photocraft") });
    const m = await mountFrame({ app: PHOTO_RASTER, fh: makeFh({ path: "img/photo.jpg" }) });
    expect(m.getByTestId("craft-sibling-chip").textContent).toBe("Save (Ctrl+S) creates photo.psd");
    expect(m.getByTestId("craft-save-target-label").textContent).toBe("Exports to .jpg");
    expect(m.getByTestId("craft-save-target-overwrite")).toBeTruthy();
  });

  it("preview claim: 'View only' chip, no save-target group", async () => {
    stubFetch({ status: statusFor("lightcraft") });
    const m = await mountFrame({ app: LIGHT, fh: makeFh({ path: "sample.dng" }) });
    expect(m.getByTestId("craft-preview-chip").textContent).toBe("View only. Exports download to this device");
    expect(m.queryByTestId("craft-save-target")).toBeNull();
  });
});

describe("E33 save-target contrast fix", () => {
  it("the selected button uses --text-primary on --accent-soft, never --accent-text", async () => {
    stubFetch({});
    const m = await mountFrame();
    const selected = m.getByTestId("craft-save-target-overwrite");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.className).toContain("text-[var(--text-primary)]");
    expect(selected.className).toContain("bg-[var(--accent-soft)]");
    expect(selected.className).not.toContain("--accent-text");
  });
});

describe("E27 view-only host", () => {
  it("setDirty(false) once opened; dirty messages ignored even after input; saves never reach props.save", async () => {
    stubFetch({ status: statusFor("lightcraft") });
    const m = await mountFrame({ app: LIGHT, fh: makeFh({ path: "sample.dng" }) });
    await shimSend(m.iframe, { type: "ready" });
    await shimSend(m.iframe, { type: "opened", title: "sample.dng", confirmed: false });
    await shimSend(m.iframe, { type: "dirty", value: true });
    await shimSend(m.iframe, { type: "dirty", value: true });
    expect(m.fh.setDirty.mock.calls.map((c) => c[0])).toEqual(["unknown", false]);
    expect(m.queryByTestId("craft-save-target")).toBeNull();
    await shimSend(m.iframe, { type: "save", suggestedName: "sample.dng", bytes: bytesOf(3) });
    expect(m.fh.save).not.toHaveBeenCalled();
    expect(saveResults(m).at(-1)).toMatchObject({ ok: true });
    await flush();
  });
});
