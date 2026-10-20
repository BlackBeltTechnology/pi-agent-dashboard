// @vitest-environment jsdom
/**
 * Status gate + renderer probe + snapshot preflight (change: edit-office-in-pane-with-craft-web).
 * Test-plan: #E2 (unverified app), #E25 (GPU probe), #X2 (offline prepare), E3 client side
 * (restart-required / disabled), over-limit file never downloads the app.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CraftFrameHost } from "../CraftFrameHost.js";
import { CRAFT_WEB_APPS, type CraftWebApp } from "../craft-apps-table.js";
import { advance, flush, makeFh, mountFrame, stubFetch, stubRenderer } from "./test-utils.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An app the status table does not verify (stand-in for an unprofiled claim). */
const DECKCRAFT: CraftWebApp = { ...CRAFT_WEB_APPS.wordcraft, id: "deckcraft", claimId: "deckcraft", label: "DeckCraft", extensions: [".pptx"] };

async function renderApp(appId: "wordcraft" | "deckcraft", path: string, fh = makeFh({ path })) {
  const r = render(<CraftFrameHost app={appId === "deckcraft" ? DECKCRAFT : CRAFT_WEB_APPS.wordcraft} {...fh} />);
  await flush();
  return { ...r, fh };
}

describe("E2 unverified app", () => {
  it("renders 'not verified', no iframe, no prepare call (status says not-verified)", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    const f = stubFetch({ status: () => ({ deckcraft: { status: "not-verified" } }) });
    const r = await renderApp("deckcraft", "deck.pptx");
    expect(r.getByTestId("craft-gate-not-verified").textContent).toContain("not verified");
    expect(r.queryByTestId("craft-frame")).toBeNull();
    expect(f.calls.some((c) => c.url.includes("/prepare/"))).toBe(false);
  });

  it("fails closed when the app is absent from status (stale claim)", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    const f = stubFetch({ status: () => ({ wordcraft: { status: "ok" } }) });
    const r = await renderApp("deckcraft", "deck.pptx");
    expect(r.getByTestId("craft-gate-not-verified")).toBeTruthy();
    expect(r.queryByTestId("craft-frame")).toBeNull();
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("status gate reasons", () => {
  it("disabled → message, nothing loads, no prepare button", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({ status: () => ({ wordcraft: { status: "disabled" } }) });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-disabled").textContent).toContain("WordCraft is disabled");
    expect(r.queryByTestId("craft-frame")).toBeNull();
    expect(r.queryByTestId("craft-prepare")).toBeNull();
  });

  it("status route absent (404) → restart-required", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({ status: () => 404 });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-restart-required").textContent).toContain("restart");
    expect(r.queryByTestId("craft-frame")).toBeNull();
  });

  it("falls back to `reason` when `status` is an unknown word", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({ status: () => ({ wordcraft: { status: "unavailable", reason: "launcher-source" } }) });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-launcher-source")).toBeTruthy();
  });

  it("unreachable status → retry, no iframe", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    let down = true;
    stubFetch({ status: () => (down ? "throw" : { wordcraft: { status: "ok" } }) });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-unreachable")).toBeTruthy();
    down = false;
    fireEvent.click(r.getByTestId("craft-gate-retry"));
    await flush();
    expect(r.getByTestId("craft-frame")).toBeTruthy();
  });

  it("not-prepared → size shown, Prepare is the only thing that downloads; success mounts the frame", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    let prepared = false;
    const f = stubFetch({
      status: () => ({ wordcraft: prepared ? { status: "ok" } : { status: "not-prepared", sizeGzip: 16_580_000 } }),
      prepare: () => {
        prepared = true;
        return { ok: true };
      },
    });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-prepare").textContent).toContain("15.8 MB");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(r.getByTestId("craft-prepare"));
    await flush();
    expect(f.calls.filter((c) => c.url.endsWith("/prepare/wordcraft") && c.method === "POST")).toHaveLength(1);
    expect(r.getByTestId("craft-frame")).toBeTruthy();
  });

  it("shim-outdated → update message with size and Prepare", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({ status: () => ({ wordcraft: { status: "shim-outdated", sizeGzip: 2 * 1024 * 1024 } }) });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-prepare").textContent).toContain("2.0 MB");
    expect(r.getByTestId("craft-prepare")).toBeTruthy();
    expect(r.queryByTestId("craft-frame")).toBeNull();
  });
});

describe("X2 offline prepare", () => {
  it("shows 'could not be prepared', keeps a Retry, never creates an iframe", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({
      status: () => ({ wordcraft: { status: "not-prepared", sizeGzip: 1000 } }),
      prepare: () => "throw",
    });
    const r = await renderApp("wordcraft", "report.docx");
    fireEvent.click(r.getByTestId("craft-prepare"));
    await flush();
    const text = r.getByTestId("craft-gate-prepare").textContent ?? "";
    expect(text).toContain("could not be prepared");
    expect(text).toContain("offline");
    expect(r.queryByTestId("craft-frame")).toBeNull();
    expect(r.getByTestId("craft-prepare").textContent).toBe("Retry");
  });

  it("server-reported offline status also reads 'could not be prepared'", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({ status: () => ({ wordcraft: { status: "offline" } }) });
    const r = await renderApp("wordcraft", "report.docx");
    expect(r.getByTestId("craft-gate-prepare").textContent).toContain("could not be prepared");
  });
});

describe("E25 GPU probe before the iframe", () => {
  const srcOf = (el: HTMLElement) => el.getAttribute("src") ?? "";

  it("navigator.gpu present → no flag", async () => {
    stubFetch({});
    const m = await mountFrame({ renderer: { gpu: true, webgl2: false } });
    expect(srcOf(m.iframe)).toMatch(/^\/apps\/craft-wordcraft\/index\.html#n=[0-9a-f]{32}$/);
  });

  it("no gpu, WebGL2 → ?webgl", async () => {
    stubFetch({});
    const m = await mountFrame({ renderer: { gpu: false, webgl2: true } });
    expect(srcOf(m.iframe)).toMatch(/^\/apps\/craft-wordcraft\/index\.html\?webgl#n=[0-9a-f]{32}$/);
  });

  it("neither → message, and no iframe is ever created", async () => {
    stubFetch({});
    stubRenderer({ gpu: false, webgl2: false });
    const fh = makeFh();
    const r = render(<CraftFrameHost app={CRAFT_WEB_APPS.wordcraft} {...fh} />);
    await flush();
    expect(r.getByTestId("craft-no-renderer").textContent).toContain("cannot run WordCraft");
    expect(r.container.querySelector("iframe")).toBeNull();
  });
});

describe("iframe attributes and per-mount nonce", () => {
  it("sandbox=allow-scripts, clipboard-write only, no allow-downloads, URL carries only #n=", async () => {
    stubFetch({});
    const m = await mountFrame();
    expect(m.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(m.iframe.getAttribute("allow")).toBe("clipboard-write");
    expect(m.iframe.getAttribute("sandbox")).not.toContain("allow-downloads");
    expect(m.iframe.getAttribute("src")).not.toMatch(/[?&](name|bytes|path)=/);
  });

  it("two mounts get different nonces", async () => {
    stubFetch({});
    const a = await mountFrame();
    const na = a.iframe.getAttribute("src");
    cleanup();
    const b = await mountFrame();
    expect(b.iframe.getAttribute("src")).not.toBe(na);
  });
});

describe("snapshot preflight (size check before the app downloads)", () => {
  it("too-large snapshot: message, Prepare never offered, no download", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    const f = stubFetch({ status: () => ({ wordcraft: { status: "not-prepared", sizeGzip: 1000 } }) });
    const fh = makeFh({ snapshot: vi.fn(async () => Promise.reject(Object.assign(new Error("file too large"), { reason: "too-large" }))) as never });
    const r = await renderApp("wordcraft", "report.docx", fh);
    expect(r.getByTestId("craft-snapshot-error").textContent).toContain("file too large");
    expect(r.queryByTestId("craft-prepare")).toBeNull();
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    await advance(1000);
  });

  it("snapshot error with a ready app: no iframe, Retry re-reads", async () => {
    stubRenderer({ gpu: true, webgl2: true });
    stubFetch({});
    const snap = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ bytes: new ArrayBuffer(4), size: 4, mtime: 1, sha1: "x" });
    const fh = makeFh({ snapshot: snap as never });
    const r = await renderApp("wordcraft", "report.docx", fh);
    expect(r.getByTestId("craft-snapshot-error").textContent).toContain("boom");
    expect(r.queryByTestId("craft-frame")).toBeNull();
    fireEvent.click(r.getByTestId("craft-snapshot-retry"));
    await flush();
    expect(r.getByTestId("craft-frame")).toBeTruthy();
  });
});
