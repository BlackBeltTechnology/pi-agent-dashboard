// @vitest-environment jsdom
/**
 * Shim-side tests for the CraftFrameHost protocol (jsdom).
 * See change: edit-office-in-pane-with-craft-web — E20, E21 (shim side), E22, E23, X4, X5.
 *
 * craft-shim.js is a classic script (no imports), so it is evaluated from source
 * with a fake `module` — independent of the package's `"type": "module"`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error jsdom has no bundled types and @types/jsdom is not installed
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SRC = readFileSync(resolve(__dirname, "../craft-shim.js"), "utf8");

interface ParsedTitle {
  raw: string;
  name: string;
  clean: boolean;
}
interface Shim {
  start(): void;
  dispose(): void;
}
interface TitleSpec {
  pattern: string;
  dirtyMarker?: string;
}
interface FrameProfile {
  appId: string;
  title: TitleSpec | null;
  openedFallbackMs: number | null;
  cleanOnAckedSave: boolean;
  saveName: "stem" | "inner-title";
  control?: { kind: "page-api" | "page-command"; global: string };
}
interface ShimModule {
  SHIM_VERSION: number;
  parseTitle(input: string | unknown[], spec?: TitleSpec): ParsedTitle | null;
  createShim(win: Window, doc: Document, opts?: { isTrusted?: (e: Event) => boolean; profile?: FrameProfile | null }): Shim;
}

function loadModule(): ShimModule {
  const m: { exports: unknown } = { exports: {} };
  new Function("module", "exports", SRC)(m, m.exports);
  return m.exports as ShimModule;
}

const NONCE = "n0nce";
const titleWarn = (t: string) => `Unhandled egui viewport command: Title("${t}")`;

interface Posted {
  msg: Record<string, any>;
  transfer: unknown[];
}

let mod: ShimModule;
let shim: Shim;
let posted: Posted[];
let rafQueue: Array<() => void>;
let origWarn: typeof console.warn;
let warnSpy: ReturnType<typeof vi.fn>;
const w = window as any;

function flushRaf(max = 20) {
  for (let i = 0; i < max && rafQueue.length; i++) rafQueue.shift()?.();
}
function sent(type: string) {
  return posted.filter((p) => p.msg.type === type).map((p) => p.msg);
}
function hostSend(data: unknown, source: unknown = window) {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource }));
}
function trusted<T extends Event>(e: T): T {
  (e as any).__trusted = true;
  return e;
}
function makeShim() {
  shim = mod.createShim(window, document, { isTrusted: (e) => (e as any).__trusted === true });
  shim.start();
}
/** Two animation frames, then the settle delay (the shim waits for both before it drops). */
async function settleDrop() {
  flushRaf();
  flushRaf();
  await vi.advanceTimersByTimeAsync(400);
}
async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}
function bytesOf(...n: number[]) {
  return new Uint8Array(n).buffer;
}

beforeEach(() => {
  mod = loadModule();
  posted = [];
  rafQueue = [];
  window.history.replaceState(null, "", `/#n=${NONCE}`);
  vi.spyOn(window, "postMessage").mockImplementation(((msg: any, _o: any, transfer: any) => {
    posted.push({ msg, transfer: transfer ?? [] });
  }) as any);
  w.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  // Pretend the browser provides the RTC globals; the shim must remove them.
  for (const n of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender"]) w[n] = function () {};
  origWarn = console.warn;
  warnSpy = vi.fn();
  console.warn = warnSpy as any;
  document.body.innerHTML = "";
  makeShim();
});

afterEach(() => {
  shim.dispose();
  console.warn = origWarn;
  vi.restoreAllMocks();
  delete w.navigation;
  delete w.showSaveFilePicker;
  delete w.showOpenFilePicker;
  delete w.showDirectoryPicker;
});

describe("version + exports", () => {
  it("exposes SHIM_VERSION on its own line and on window", () => {
    expect(SRC).toMatch(/^const SHIM_VERSION = (\d+);$/m);
    expect(mod.SHIM_VERSION).toBe(Number(/^const SHIM_VERSION = (\d+);$/m.exec(SRC)?.[1]));
    expect(w.__CRAFT_SHIM_VERSION__).toBe(mod.SHIM_VERSION);
  });

  it("self-runs as an IIFE when there is no `module` (isolated window, so nothing leaks)", () => {
    const dom = new JSDOM('<canvas></canvas>', { url: `https://x.test/#n=${NONCE}`, runScripts: "outside-only", pretendToBeVisual: false });
    const win: any = dom.window;
    const out: any[] = [];
    win.postMessage = (m: unknown) => out.push(m);
    const queue: Array<() => void> = [];
    win.requestAnimationFrame = (cb: () => void) => queue.push(cb);
    win.eval(SRC);
    expect(win.__CRAFT_SHIM_VERSION__).toBe(mod.SHIM_VERSION);
    expect(win.RTCPeerConnection).toBeUndefined();
    win.dispatchEvent(new win.Event("TrunkApplicationStarted"));
    while (queue.length) queue.shift()?.();
    expect(out).toEqual([{ type: "ready", nonce: NONCE, shimVersion: mod.SHIM_VERSION, control: false }]);
    dom.window.close();
  });
});

describe("parseTitle", () => {
  it.each([
    [titleWarn("report - WordCraft"), "report", true],
    [titleWarn("report • - WordCraft"), "report", false],
    [titleWarn("report.docx • - WordCraft"), "report.docx", false],
    [titleWarn("My \\\"quoted\\\" doc - WordCraft"), 'My "quoted" doc', true],
    [titleWarn("a - b - WordCraft"), "a - b", true],
  ])("%s", (text, name, clean) => {
    const t = mod.parseTitle(text);
    expect(t?.name).toBe(name);
    expect(t?.clean).toBe(clean);
  });

  it("accepts console arg arrays and ignores other warnings", () => {
    expect(mod.parseTitle(["[WARN]", titleWarn("x - WordCraft")])?.name).toBe("x");
    expect(mod.parseTitle("something else")).toBeNull();
  });
});

describe("console.warn wrapper", () => {
  it("still calls the original", () => {
    console.warn("hello", 1);
    expect(warnSpy).toHaveBeenCalledWith("hello", 1);
    console.warn(titleWarn("zzz - WordCraft"));
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe("ready ordering", () => {
  it("no ready before TrunkApplicationStarted, canvas or a frame", async () => {
    document.body.innerHTML = "<canvas></canvas>";
    flushRaf();
    expect(sent("ready")).toHaveLength(0);
    window.dispatchEvent(new Event("TrunkApplicationStarted"));
    expect(sent("ready")).toHaveLength(0); // needs one more animation frame
    flushRaf();
    expect(sent("ready")).toEqual([{ type: "ready", nonce: NONCE, shimVersion: mod.SHIM_VERSION, control: false }]);
    window.dispatchEvent(new Event("TrunkApplicationStarted"));
    flushRaf();
    expect(sent("ready")).toHaveLength(1);
  });

  it("waits for the canvas after the started event", async () => {
    window.dispatchEvent(new Event("TrunkApplicationStarted"));
    flushRaf(5);
    expect(sent("ready")).toHaveLength(0);
    document.body.innerHTML = "<canvas></canvas>";
    flushRaf();
    expect(sent("ready")).toHaveLength(1);
  });

  it("posts nothing without a nonce in the hash", () => {
    shim.dispose();
    window.history.replaceState(null, "", "/");
    makeShim();
    document.body.innerHTML = "<canvas></canvas>";
    window.dispatchEvent(new Event("TrunkApplicationStarted"));
    flushRaf();
    expect(posted).toHaveLength(0);
  });
});

describe("open → synthetic drop, opened (X4 shim side)", () => {
  let dropped: Array<{ name: string; size: number; target: EventTarget | null }>;
  let onDrop: (e: Event) => void;
  beforeEach(() => {
    document.body.innerHTML = "<canvas></canvas>";
    dropped = [];
    onDrop = (e: any) => {
      const f = e.dataTransfer?.files?.[0];
      dropped.push({ name: f?.name, size: f?.size, target: e.target });
    };
    window.addEventListener("drop", onDrop);
  });
  afterEach(() => window.removeEventListener("drop", onDrop));

  it("drops a File on the canvas once, after the app's first update tick; ignores wrong nonce/source and a second open", async () => {
    hostSend({ type: "open", nonce: "bad", name: "report.docx", bytes: bytesOf(1) });
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) }, null);
    expect(dropped).toHaveLength(0);
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1, 2, 3) });
    hostSend({ type: "open", nonce: NONCE, name: "other.docx", bytes: bytesOf(9) });
    expect(dropped).toHaveLength(0); // WordCraft 0.8.0 ignores a drop that precedes its first update tick
    vi.useFakeTimers();
    try {
      console.warn(titleWarn("WordCraft")); // the app's first viewport-title signal = the loop runs
      await settleDrop();
    } finally {
      vi.useRealTimers();
    }
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ name: "report.docx", size: 3 });
    expect((dropped[0].target as Element).nodeName).toBe("CANVAS");
    // the shim's own drop is exempt from the open-refusal path
    expect(sent("blocked")).toHaveLength(0);
  });

  it("delivers anyway after the fallback delay when the app never signals a title", async () => {
    vi.useFakeTimers();
    try {
      hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1, 2) });
      await vi.advanceTimersByTimeAsync(1000);
      expect(dropped).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2500);
      await settleDrop();
      expect(dropped).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no opened until a title names the delivered document", () => {
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
    console.warn(titleWarn("WordCraft"));
    console.warn(titleWarn("other - WordCraft"));
    expect(sent("opened")).toHaveLength(0);
    console.warn(titleWarn("report.docx - WordCraft"));
    expect(sent("opened")).toEqual([{ type: "opened", nonce: NONCE, title: "report.docx", confirmed: true }]);
    console.warn(titleWarn("report.docx • - WordCraft"));
    expect(sent("opened")).toHaveLength(1);
  });

  it("matches title with the extension stripped, case/NFC-insensitively", () => {
    hostSend({ type: "open", nonce: NONCE, name: "Résumé.DOCX", bytes: bytesOf(1) });
    console.warn(titleWarn("re\u0301sume\u0301 - WordCraft"));
    expect(sent("opened")).toHaveLength(1);
  });

  it("title before `open` is ignored", () => {
    console.warn(titleWarn("report - WordCraft"));
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
    expect(sent("opened")).toHaveLength(0);
  });
});

describe("dirty derivation (E20)", () => {
  const dirtyValues = () => sent("dirty").map((m) => m.value);
  beforeEach(() => {
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
    console.warn(titleWarn("report - WordCraft"));
  });

  it("clean on open; trusted keydown → true; • title keeps true; clean title → false", () => {
    expect(dirtyValues()).toEqual([false]);
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    expect(dirtyValues()).toEqual([false, true]);
    console.warn(titleWarn("report • - WordCraft"));
    expect(dirtyValues()).toEqual([false, true]); // deduped, still true
    console.warn(titleWarn("report - WordCraft")); // save
    expect(dirtyValues()).toEqual([false, true, false]);
  });

  it("copy save: shim only reports title-clean (host keeps its own dirty)", () => {
    console.warn(titleWarn("report • - WordCraft"));
    console.warn(titleWarn("report - WordCraft"));
    expect(dirtyValues().at(-1)).toBe(false);
  });

  it("clean title is NOT clean when input followed a re-sent identical title", () => {
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    console.warn(titleWarn("report - WordCraft")); // same title again, no change
    expect(dirtyValues().at(-1)).toBe(true);
  });

  it("untrusted input and bare modifiers are ignored", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Shift" })));
    expect(dirtyValues()).toEqual([false]);
  });

  it("paste (text), cut and a trusted drop without files force true", () => {
    for (const make of [() => new Event("paste"), () => new Event("cut"), () => new Event("drop")]) {
      shim.dispose();
      posted = [];
      makeShim();
      hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
      console.warn(titleWarn("report - WordCraft"));
      window.dispatchEvent(trusted(make()));
      expect(dirtyValues()).toEqual([false, true]);
    }
  });

  it("pointerdown followed by a non-marker title change forces true", () => {
    window.dispatchEvent(trusted(new Event("pointerdown")));
    console.warn(titleWarn("report (2 pages) - WordCraft"));
    expect(dirtyValues().at(-1)).toBe(true);
  });

  it("pointerdown + bullet flip to clean (click on Save) stays clean", () => {
    console.warn(titleWarn("report • - WordCraft"));
    window.dispatchEvent(trusted(new Event("pointerdown")));
    console.warn(titleWarn("report - WordCraft"));
    expect(dirtyValues().at(-1)).toBe(false);
  });

  it("Cmd/Ctrl+S default is prevented and does not count as an edit", () => {
    const ev = new KeyboardEvent("keydown", { key: "s", metaKey: true, cancelable: true });
    window.dispatchEvent(trusted(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(dirtyValues()).toEqual([false]);
  });
});

describe("showSaveFilePicker stub", () => {
  it("posts a TRANSFERRED buffer on close and resolves on save-result ok", async () => {
    const handle = await w.showSaveFilePicker({ suggestedName: "report.docx" });
    const ws = await handle.createWritable();
    await ws.write(new Uint8Array([1, 2]));
    await ws.write({ type: "write", data: new Blob([new Uint8Array([3])]) });
    await ws.write("A");
    expect(sent("save")).toHaveLength(0); // buffered until close
    let done = false;
    const closing = ws.close().then(() => {
      done = true;
    });
    await tick();
    const [p] = posted.filter((x) => x.msg.type === "save");
    expect(p.msg).toMatchObject({
      nonce: NONCE,
      suggestedName: "report.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(Array.from(new Uint8Array(p.msg.bytes))).toEqual([1, 2, 3, 65]);
    expect(p.transfer).toEqual([p.msg.bytes]);
    expect(done).toBe(false); // waits for the host
    hostSend({ type: "save-result", nonce: NONCE, ok: true });
    await closing;
    expect(done).toBe(true);
  });

  it("rejects with AbortError on save-result ok:false", async () => {
    const handle = await w.showSaveFilePicker({ suggestedName: "x.docx" });
    const ws = await handle.createWritable();
    await ws.write(new Uint8Array([1]));
    const closing = ws.close();
    await tick();
    hostSend({ type: "save-result", nonce: NONCE, ok: false, error: "too big" });
    await expect(closing).rejects.toMatchObject({ name: "AbortError" });
  });

  it("supports seek/truncate/positioned writes", async () => {
    const ws = await (await w.showSaveFilePicker({ suggestedName: "a.bin" })).createWritable();
    await ws.write(new Uint8Array([1, 2, 3, 4]));
    await ws.write({ type: "write", position: 1, data: new Uint8Array([9]) });
    await ws.truncate(3);
    const closing = ws.close();
    await tick();
    expect(Array.from(new Uint8Array(sent("save")[0].bytes))).toEqual([1, 9, 3]);
    hostSend({ type: "save-result", nonce: NONCE, ok: true });
    await closing;
  });

  it("ignores save-result with wrong nonce or source", async () => {
    const ws = await (await w.showSaveFilePicker({ suggestedName: "a.docx" })).createWritable();
    await ws.write(new Uint8Array([1]));
    let done = false;
    const closing = ws.close().then(() => {
      done = true;
    });
    await tick();
    hostSend({ type: "save-result", nonce: "bad", ok: true });
    hostSend({ type: "save-result", nonce: NONCE, ok: true }, null);
    await tick();
    expect(done).toBe(false);
    hostSend({ type: "save-result", nonce: NONCE, ok: true });
    await closing;
  });
});

describe("anchor download interception (X5)", () => {
  it("fetch is issued synchronously inside click(), so a revoke right after cannot lose bytes", async () => {
    let revoked = false;
    let fetchedWhileLive = false;
    const fetchMock = vi.fn((href: string) => {
      fetchedWhileLive = !revoked;
      return Promise.resolve({
        headers: { get: () => "application/pdf" },
        arrayBuffer: () => Promise.resolve(bytesOf(7, 8)),
      });
    });
    // fetch is captured at shim start
    shim.dispose();
    w.fetch = fetchMock;
    makeShim();

    const a = document.createElement("a");
    a.href = "blob:https://host/abc";
    a.download = "export.pdf";
    a.click();
    revoked = true; // app revokes synchronously after click
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchedWhileLive).toBe(true);
    await tick();
    const [msg] = sent("save");
    expect(msg).toMatchObject({ suggestedName: "export.pdf", mime: "application/pdf" });
    expect(Array.from(new Uint8Array(msg.bytes))).toEqual([7, 8]);
    expect(posted.find((p) => p.msg.type === "save")?.transfer).toEqual([msg.bytes]);
    hostSend({ type: "save-result", nonce: NONCE, ok: true });
  });

  it("intercepts a capture-phase click on an attached anchor and prevents navigation", async () => {
    w.fetch = vi.fn(() => Promise.resolve({ headers: { get: () => null }, arrayBuffer: () => Promise.resolve(bytesOf(1)) }));
    shim.dispose();
    makeShim();
    const a = document.createElement("a");
    a.href = "blob:https://host/xyz";
    a.download = "x.docx";
    document.body.append(a);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(w.fetch).toHaveBeenCalledTimes(1);
    await tick();
    expect(sent("save")[0]).toMatchObject({ suggestedName: "x.docx" });
    hostSend({ type: "save-result", nonce: NONCE, ok: true });
  });

  it("decodes data: URLs locally (not in connect-src)", async () => {
    const fetchMock = vi.fn();
    shim.dispose();
    w.fetch = fetchMock;
    makeShim();
    const a = document.createElement("a");
    a.href = "data:text/plain;base64,aGk=";
    a.download = "hi.txt";
    a.click();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent("save")[0]).toMatchObject({ suggestedName: "hi.txt", mime: "text/plain" });
    expect(Array.from(new Uint8Array(sent("save")[0].bytes))).toEqual([104, 105]);
  });

  it("leaves ordinary (non-download) anchors alone", () => {
    const a = document.createElement("a");
    a.href = "#frag";
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.body.append(a);
    a.dispatchEvent(ev);
    expect(sent("save")).toHaveLength(0);
  });
});

describe("open refusal (E22)", () => {
  const file = new File(["x"], "evil.docx");

  it("file input click (attached and detached) and showPicker → refused + blocked", () => {
    const attached = document.createElement("input");
    attached.type = "file";
    document.body.append(attached);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    attached.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const detached = document.createElement("input");
    detached.type = "file";
    const spy = vi.spyOn(HTMLElement.prototype, "click");
    detached.click();
    expect(sent("blocked").map((m) => m.what)).toEqual(["file-input", "file-input"]);
    spy.mockRestore();
  });

  it("non-file inputs still click normally", () => {
    const text = document.createElement("input");
    document.body.append(text);
    const handler = vi.fn();
    text.addEventListener("click", handler);
    text.click();
    expect(handler).toHaveBeenCalled();
    expect(sent("blocked")).toHaveLength(0);
  });

  it("showOpenFilePicker → AbortError + blocked", async () => {
    await expect(w.showOpenFilePicker()).rejects.toMatchObject({ name: "AbortError" });
    expect(sent("blocked")).toEqual([{ type: "blocked", nonce: NONCE, what: "showOpenFilePicker" }]);
  });

  it("trusted drop carrying files → refused (stopped before the app) + blocked", () => {
    document.body.innerHTML = "<canvas></canvas>";
    const appHandler = vi.fn();
    document.querySelector("canvas")!.addEventListener("drop", appHandler);
    const ev = trusted(new Event("drop", { bubbles: true, cancelable: true }));
    Object.defineProperty(ev, "dataTransfer", { value: { files: [file], types: ["Files"] } });
    document.querySelector("canvas")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(appHandler).not.toHaveBeenCalled();
    expect(sent("blocked").map((m) => m.what)).toEqual(["drop-files"]);
  });

  it("untrusted drop with files is not refused (only the shim's own drop is synthetic)", () => {
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { files: [file], types: ["Files"] } });
    window.dispatchEvent(ev);
    expect(sent("blocked")).toHaveLength(0);
  });

  it("paste with a file item → refused + blocked; paste with text untouched", () => {
    const pasteFile = trusted(new Event("paste", { bubbles: true, cancelable: true }));
    Object.defineProperty(pasteFile, "clipboardData", {
      value: { files: [], types: ["Files"], items: [{ kind: "file", type: "application/octet-stream" }] },
    });
    window.dispatchEvent(pasteFile);
    expect(pasteFile.defaultPrevented).toBe(true);
    expect(sent("blocked").map((m) => m.what)).toEqual(["paste-files"]);

    const pasteText = trusted(new Event("paste", { bubbles: true, cancelable: true }));
    Object.defineProperty(pasteText, "clipboardData", {
      value: { files: [], types: ["text/plain"], items: [{ kind: "string", type: "text/plain" }] },
    });
    window.dispatchEvent(pasteText);
    expect(pasteText.defaultPrevented).toBe(false);
    expect(sent("blocked")).toHaveLength(1);
  });
});

describe("WebRTC removal (E23)", () => {
  it.each(["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCRtpSender"])("%s is undefined", (name) => {
    expect(w[name]).toBeUndefined();
  });

  it("removes them even when they are non-configurable-looking accessors", () => {
    shim.dispose();
    Object.defineProperty(window, "RTCPeerConnection", { value: function () {}, configurable: true, writable: true });
    makeShim();
    expect(w.RTCPeerConnection).toBeUndefined();
  });
});

describe("CSP + navigation", () => {
  it("forwards securitypolicyviolation as csp{directive}", () => {
    const ev = Object.assign(new Event("securitypolicyviolation", { bubbles: true }), { violatedDirective: "connect-src" });
    document.dispatchEvent(ev);
    expect(sent("csp")).toEqual([{ type: "csp", nonce: NONCE, directive: "connect-src" }]);
  });

  function navEvent(over: Record<string, unknown>) {
    return Object.assign(new Event("navigate", { cancelable: true }), { hashChange: false, downloadRequest: null, ...over });
  }

  it("cancels cross-document navigations and reports the url", () => {
    shim.dispose();
    const nav = new EventTarget();
    w.navigation = nav;
    makeShim();
    const ev = navEvent({ destination: { url: "https://example.com/x", sameDocument: false } });
    nav.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(sent("navigate-blocked")).toEqual([{ type: "navigate-blocked", nonce: NONCE, url: "https://example.com/x" }]);
  });

  it("leaves same-document, hash and non-cancelable navigations alone", () => {
    shim.dispose();
    const nav = new EventTarget();
    w.navigation = nav;
    makeShim();
    const same = navEvent({ destination: { url: "https://h/#a", sameDocument: true } });
    const hash = navEvent({ destination: { url: "https://h/#b", sameDocument: false }, hashChange: true });
    const nonCancel = Object.assign(new Event("navigate", { cancelable: false }), {
      hashChange: false,
      downloadRequest: null,
      destination: { url: "https://x/", sameDocument: false },
    });
    for (const e of [same, hash, nonCancel]) nav.dispatchEvent(e);
    expect(same.defaultPrevented || hash.defaultPrevented || nonCancel.defaultPrevented).toBe(false);
    expect(sent("navigate-blocked")).toHaveLength(0);
  });

  it("cancels a link click and a script anchor click that would navigate the frame (Navigation API is absent in an opaque-origin frame)", () => {
    const a = document.createElement("a");
    a.href = "https://example.com/doc";
    document.body.append(a);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    a.click(); // script-initiated: the prototype click is wrapped too
    expect(sent("navigate-blocked")).toEqual([
      { type: "navigate-blocked", nonce: NONCE, url: "https://example.com/doc" },
      { type: "navigate-blocked", nonce: NONCE, url: "https://example.com/doc" },
    ]);
  });

  it("leaves fragment links and download anchors out of the navigation block", () => {
    const hash = document.createElement("a");
    hash.href = "#section";
    document.body.append(hash);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    hash.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(sent("navigate-blocked")).toHaveLength(0);
  });

  it("window.open is cancelled and reported (eframe opens hyperlinks with it)", () => {
    expect(w.open("https://example.com/x", "_self")).toBeNull();
    expect(w.open("https://example.com/y")).toBeNull();
    expect(sent("navigate-blocked").map((m) => m.url)).toEqual(["https://example.com/x", "https://example.com/y"]);
  });

  it("is a no-op without the Navigation API", () => {
    expect(w.navigation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
// Shim v2 — adapter profiles (change: extend-craft-web-to-all-apps, D4/D5)
// ---------------------------------------------------------------------------------------------------

const WORDCRAFT: FrameProfile = {
  appId: "wordcraft",
  title: { pattern: "^(.*?)(?: •)? [-–—] WordCraft$", dirtyMarker: "•" },
  openedFallbackMs: null,
  cleanOnAckedSave: false,
  saveName: "stem",
};
const PHOTOCRAFT: FrameProfile = { ...WORDCRAFT, appId: "photocraft", title: { pattern: "^(.*) [-–—] PhotoCraft$" }, cleanOnAckedSave: true };
const GRIDCRAFT: FrameProfile = { ...WORDCRAFT, appId: "gridcraft", title: { pattern: "^(.*?)(?: — Edited)?$", dirtyMarker: "— Edited" }, cleanOnAckedSave: true };
const CADCRAFT: FrameProfile = { ...WORDCRAFT, appId: "cadcraft", title: null, openedFallbackMs: 3000, cleanOnAckedSave: true };
const LIGHTCRAFT: FrameProfile = { ...CADCRAFT, appId: "lightcraft", openedFallbackMs: 5000 };

function makeProfiledShim(profile: FrameProfile | null) {
  shim.dispose();
  posted = [];
  shim = mod.createShim(window, document, { isTrusted: (e) => (e as any).__trusted === true, profile });
  shim.start();
}

describe("E8 title parsing per profile", () => {
  it.each([
    ["report • - WordCraft", WORDCRAFT, "report", false],
    ["report - WordCraft", WORDCRAFT, "report", true],
    ["report — WordCraft", WORDCRAFT, "report", true],
    ["report.docx • - WordCraft", WORDCRAFT, "report.docx", false],
    ["photo.jpg — PhotoCraft", PHOTOCRAFT, "photo.jpg", true],
    ["budget.xlsx", GRIDCRAFT, "budget.xlsx", true],
    ["budget.xlsx — Edited", GRIDCRAFT, "budget.xlsx", false],
  ] as const)("%s", (title, profile, name, clean) => {
    const t = mod.parseTitle(titleWarn(title), profile.title as TitleSpec);
    expect(t?.name).toBe(name);
    expect(t?.clean).toBe(clean);
  });

  it("the v1 rule (no profile) strips an em-dash suffix too", () => {
    expect(mod.parseTitle(titleWarn("photo.jpg — PhotoCraft"))?.name).toBe("photo.jpg");
  });

  it("a title that does not match the pattern parses to null", () => {
    expect(mod.parseTitle(titleWarn("LightCraft"), PHOTOCRAFT.title as TitleSpec)).toBeNull();
  });

  it.each([
    [WORDCRAFT, "report.docx", "report • - WordCraft", "report", true],
    [PHOTOCRAFT, "photo.jpg", "photo.jpg — PhotoCraft", "photo.jpg", false],
    [GRIDCRAFT, "budget.xlsx", "budget.xlsx — Edited", "budget.xlsx", true],
  ] as const)("%# opens on a title naming the delivered document, with the dirty marker deciding dirty", (profile, file, title, name, dirty) => {
    makeProfiledShim(profile);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: file, bytes: bytesOf(1) });
    console.warn(titleWarn(title));
    expect(sent("opened")).toEqual([{ type: "opened", nonce: NONCE, title: name, confirmed: true }]);
    expect(sent("dirty").map((m) => m.value)).toEqual([dirty]);
  });

  it("`Book1` (GridCraft) and `LightCraft` (no-title profile) never post opened", () => {
    makeProfiledShim(GRIDCRAFT);
    hostSend({ type: "open", nonce: NONCE, name: "budget.xlsx", bytes: bytesOf(1) });
    console.warn(titleWarn("Book1"));
    expect(sent("opened")).toHaveLength(0);
    makeProfiledShim(LIGHTCRAFT);
    hostSend({ type: "open", nonce: NONCE, name: "LightCraft", bytes: bytesOf(1) });
    console.warn(titleWarn("LightCraft"));
    expect(sent("opened")).toHaveLength(0);
  });
});

describe("E9 dirty rules with cleanOnAckedSave", () => {
  const dirtyValues = () => sent("dirty").map((m) => m.value);

  async function openGrid(profile: FrameProfile) {
    makeProfiledShim(profile);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "budget.xlsx", bytes: bytesOf(1) });
    console.warn(titleWarn("budget.xlsx"));
  }

  /** Save through the picker stub; resolves once the shim posted `save` (wrapped: an async fn would flatten the promise). */
  async function requestSave(): Promise<{ closing: Promise<void> }> {
    const ws = await (await w.showSaveFilePicker({ suggestedName: "budget.xlsx" })).createWritable();
    await ws.write(new Uint8Array([1]));
    const closing = ws.close();
    await tick();
    return { closing };
  }

  async function editThenSave(ack: Record<string, unknown>, opts: { inputAfterRequest?: boolean } = {}) {
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    console.warn(titleWarn("budget.xlsx — Edited"));
    const { closing } = await requestSave();
    if (opts.inputAfterRequest) window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "b" })));
    hostSend({ type: "save-result", nonce: NONCE, ok: true, ...ack });
    await closing;
  }

  it("true + acknowledged own overwrite → dirty:false, a persisting `— Edited` keeps it false", async () => {
    await openGrid(GRIDCRAFT);
    await editThenSave({ own: true });
    expect(dirtyValues()).toEqual([false, true, false]);
    console.warn(titleWarn("budget.xlsx — Edited")); // GridCraft re-sends the same title
    expect(dirtyValues().at(-1)).toBe(false);
  });

  it("a title CHANGE to `— Edited` after the ack raises dirty", async () => {
    await openGrid(GRIDCRAFT);
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    const { closing } = await requestSave();
    hostSend({ type: "save-result", nonce: NONCE, ok: true, own: true });
    await closing;
    expect(dirtyValues().at(-1)).toBe(false);
    console.warn(titleWarn("budget.xlsx — Edited"));
    expect(dirtyValues().at(-1)).toBe(true);
  });

  it("copy / sibling acknowledgements (own absent or false) keep dirty", async () => {
    await openGrid(GRIDCRAFT);
    await editThenSave({ own: false });
    expect(dirtyValues().at(-1)).toBe(true);
    await editThenSave({});
    expect(dirtyValues().at(-1)).toBe(true);
  });

  it("trusted input after the save request, before the ack, keeps dirty", async () => {
    await openGrid(GRIDCRAFT);
    await editThenSave({ own: true }, { inputAfterRequest: true });
    expect(dirtyValues().at(-1)).toBe(true);
  });

  it("cleanOnAckedSave:false (WordCraft): an ack changes nothing, only the title clears", async () => {
    makeProfiledShim(WORDCRAFT);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
    console.warn(titleWarn("report - WordCraft"));
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    console.warn(titleWarn("report • - WordCraft"));
    const { closing } = await requestSave();
    hostSend({ type: "save-result", nonce: NONCE, ok: true, own: true });
    await closing;
    expect(dirtyValues().at(-1)).toBe(true);
    console.warn(titleWarn("report - WordCraft"));
    expect(dirtyValues().at(-1)).toBe(false);
  });
});

describe("E10 opened fallback (no-title profile)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openCad() {
    makeProfiledShim(CADCRAFT);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "plan.dxf", bytes: bytesOf(1) });
    await vi.advanceTimersByTimeAsync(3000); // drop fallback: no title tick
    await settleDrop(); // the drop is delivered now
  }

  it("(a) posts opened{confirmed:false} then dirty:false after openedFallbackMs", async () => {
    await openCad(); // the drop went out 150 ms ago (settle = 250 ms of the 400 advanced)
    await vi.advanceTimersByTimeAsync(2700);
    expect(sent("opened")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent("opened")).toEqual([{ type: "opened", nonce: NONCE, title: "plan.dxf", confirmed: false }]);
    expect(posted.map((p) => p.msg.type).slice(-2)).toEqual(["opened", "dirty"]);
    expect(sent("dirty")).toEqual([{ type: "dirty", nonce: NONCE, value: false }]);
  });

  it("(b) canvas removed at 2000 ms → no opened", async () => {
    await openCad();
    await vi.advanceTimersByTimeAsync(2000);
    document.body.innerHTML = "";
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent("opened")).toHaveLength(0);
  });

  it("(c) frame reload (pagehide) at 2000 ms → no opened", async () => {
    await openCad();
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent("opened")).toHaveLength(0);
  });

  it("(d) start error at 1000 ms → start-failed, no opened", async () => {
    await openCad();
    await vi.advanceTimersByTimeAsync(1000);
    console.error("panicked at src/main.rs:1:1: boom");
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent("start-failed")).toHaveLength(1);
    expect(sent("opened")).toHaveLength(0);
  });

  it("titles never open a no-title profile (a static app title is not a document title)", async () => {
    makeProfiledShim(CADCRAFT);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "CADCraft", bytes: bytesOf(1) });
    console.warn(titleWarn("CADCraft"));
    await settleDrop();
    expect(sent("opened")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent("opened")).toHaveLength(1);
  });

  it("then input → dirty:true, acknowledged own save → dirty:false", async () => {
    await openCad();
    await vi.advanceTimersByTimeAsync(3000);
    window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "a" })));
    expect(sent("dirty").map((m) => m.value)).toEqual([false, true]);
    const ws = await (await w.showSaveFilePicker({ suggestedName: "plan.dxf" })).createWritable();
    await ws.write(new Uint8Array([1]));
    const closing = ws.close();
    await vi.advanceTimersByTimeAsync(0);
    hostSend({ type: "save-result", nonce: NONCE, ok: true, own: true });
    await closing;
    expect(sent("dirty").map((m) => m.value)).toEqual([false, true, false]);
  });
});

describe("E11 start-failed detector", () => {
  it("a WebAssembly.RuntimeError window error before opened → one start-failed", () => {
    makeProfiledShim(WORDCRAFT);
    const err = new WebAssembly.RuntimeError("unreachable");
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: String(err) }));
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: String(err) }));
    expect(sent("start-failed")).toHaveLength(1);
  });

  it("console.error 'panicked at …' before opened → start-failed; the original console.error still runs", () => {
    shim.dispose(); // restores the pre-shim console.error before the spy goes in
    const orig = console.error;
    const spy = vi.fn();
    console.error = spy as any;
    try {
      posted = [];
      shim = mod.createShim(window, document, { profile: WORDCRAFT });
      shim.start();
      console.error("panicked at library/std/src/sys/pal/wasm/../unsupported/os.rs: no pids on this platform");
      expect(sent("start-failed")).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      shim.dispose();
      console.error = orig;
      makeShim();
    }
  });

  it("an unhandled rejection with a RuntimeError before opened → start-failed", () => {
    makeProfiledShim(WORDCRAFT);
    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new WebAssembly.RuntimeError("unreachable executed");
    window.dispatchEvent(ev);
    expect(sent("start-failed")).toHaveLength(1);
  });

  it("the same events after opened → no start-failed", () => {
    makeProfiledShim(WORDCRAFT);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "report.docx", bytes: bytesOf(1) });
    console.warn(titleWarn("report - WordCraft"));
    expect(sent("opened")).toHaveLength(1);
    window.dispatchEvent(new ErrorEvent("error", { error: new WebAssembly.RuntimeError("unreachable") }));
    console.error("panicked at x");
    expect(sent("start-failed")).toHaveLength(0);
  });

  it("an ordinary error is not a start failure", () => {
    makeProfiledShim(WORDCRAFT);
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("x is undefined"), message: "x is undefined" }));
    console.error("failed to load favicon");
    expect(sent("start-failed")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// Shim v3 — live control relay (change: add-craft-live-control, D3)
// ---------------------------------------------------------------------------------------------------

describe("shim v3 live control", () => {
  const FAKE: FrameProfile = {
    appId: "fakecraft",
    title: null,
    openedFallbackMs: 1000,
    cleanOnAckedSave: true,
    saveName: "stem",
    control: { kind: "page-api", global: "fakecraft" },
  };
  const control = (id: number, method: string, params?: unknown) => hostSend({ type: "control", nonce: NONCE, id, method, params });
  const results = () => sent("control-result");

  /** A shim for `profile` whose document is open (no-title fallback). */
  async function openWith(profile: FrameProfile) {
    makeProfiledShim(profile);
    document.body.innerHTML = "<canvas></canvas>";
    hostSend({ type: "open", nonce: NONCE, name: "doc.fake", bytes: bytesOf(1) });
    await vi.advanceTimersByTimeAsync(3000);
    flushRaf();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent("opened")).toHaveLength(1);
  }
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete w.fakecraft;
    delete w.lightcraft;
  });

  it("E17 before opened → not-ready, nothing is called", async () => {
    const request = vi.fn();
    w.fakecraft = { request };
    makeProfiledShim(FAKE);
    control(1, "ui.inspect");
    expect(results()).toEqual([{ type: "control-result", nonce: NONCE, id: 1, ok: false, code: "not-ready", error: expect.any(String) }]);
    expect(request).not.toHaveBeenCalled();
  });

  it("E17 after opened → resolve/reject of request relays as ok:true/false", async () => {
    await openWith(FAKE);
    w.fakecraft = { request: vi.fn((m: string) => (m === "boom" ? Promise.reject(new Error("bad thing")) : Promise.resolve({ m }))) };
    control(2, "ui.inspect");
    control(3, "boom");
    await vi.advanceTimersByTimeAsync(10);
    expect(results().find((r) => r.id === 2)).toMatchObject({ ok: true, result: { m: "ui.inspect" } });
    expect(results().find((r) => r.id === 3)).toMatchObject({ ok: false, error: "bad thing" });
    expect(results().find((r) => r.id === 3)?.code).toBeUndefined();
  });

  it("E17 a wrong nonce or a foreign event source is ignored", async () => {
    await openWith(FAKE);
    const request = vi.fn(() => Promise.resolve(1));
    w.fakecraft = { request };
    hostSend({ type: "control", nonce: "other", id: 4, method: "x" });
    hostSend({ type: "control", nonce: NONCE, id: 5, method: "x" }, {});
    await vi.advanceTimersByTimeAsync(10);
    expect(request).not.toHaveBeenCalled();
    expect(results()).toHaveLength(0);
  });

  it("E17 a page API that never appears → unsupported after 2 s; a late global within 2 s still answers", async () => {
    await openWith(FAKE);
    control(6, "ui.inspect");
    await vi.advanceTimersByTimeAsync(1900);
    expect(results()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(results()).toEqual([expect.objectContaining({ id: 6, ok: false, code: "unsupported" })]);
    control(7, "ui.inspect");
    await vi.advanceTimersByTimeAsync(500);
    w.fakecraft = { request: () => Promise.resolve("late") };
    await vi.advanceTimersByTimeAsync(200);
    expect(results().find((r) => r.id === 7)).toMatchObject({ ok: true, result: "late" });
  });

  it("E17 a profile without control → unsupported", async () => {
    await openWith({ ...FAKE, control: undefined });
    control(8, "ui.inspect");
    expect(results()).toEqual([expect.objectContaining({ id: 8, ok: false, code: "unsupported" })]);
  });

  it("E17 a non-cloneable reply becomes an error, never a throw", async () => {
    await openWith(FAKE);
    w.fakecraft = { request: () => Promise.resolve({ f: () => 1 }) };
    const real = window.postMessage as unknown as ReturnType<typeof vi.fn>;
    real.mockImplementationOnce(() => {
      throw new DOMException("could not be cloned", "DataCloneError");
    });
    control(9, "x");
    await vi.advanceTimersByTimeAsync(10);
    expect(results().find((r) => r.id === 9)).toMatchObject({ ok: false, error: expect.stringMatching(/not serializable/) });
  });

  describe("E27 page-command", () => {
    const LIGHT: FrameProfile = { ...FAKE, appId: "lightcraft", control: { kind: "page-command", global: "lightcraft" } };

    it("engine.execute → command(id, JSON text) → parsed reply; bad JSON → app_error; other methods → unsupported", async () => {
      await openWith(LIGHT);
      const command = vi.fn((id: string) => Promise.resolve(id === "x" ? "not json" : '{"n":2}'));
      w.lightcraft = { command };
      control(10, "engine.execute", { command: "library.info", params: { a: 1 } });
      control(11, "engine.execute", { command: "x" });
      control(12, "ui.screenshot");
      await vi.advanceTimersByTimeAsync(10);
      expect(command).toHaveBeenNthCalledWith(1, "library.info", '{"a":1}');
      expect(command).toHaveBeenNthCalledWith(2, "x", "{}");
      expect(command).toHaveBeenCalledTimes(2);
      expect(results().find((r) => r.id === 10)).toMatchObject({ ok: true, result: { n: 2 } });
      expect(results().find((r) => r.id === 11)).toMatchObject({ ok: false, error: expect.any(String) });
      expect(results().find((r) => r.id === 11)?.code).toBeUndefined();
      expect(results().find((r) => r.id === 12)).toMatchObject({ ok: false, code: "unsupported", error: expect.stringMatching(/page-command/) });
    });
  });

  it("E18 ready announces shimVersion and control; saves carry numeric msSinceInput", async () => {
    makeProfiledShim(FAKE);
    document.body.innerHTML = "<canvas></canvas>";
    window.dispatchEvent(new Event("TrunkApplicationStarted"));
    await vi.advanceTimersByTimeAsync(100); // fake timers also fake requestAnimationFrame
    expect(sent("ready")).toEqual([{ type: "ready", nonce: NONCE, shimVersion: 3, control: true }]);
    const ws = await (await w.showSaveFilePicker({ suggestedName: "a.txt" })).createWritable();
    await ws.write(new Uint8Array([1]));
    void ws.close();
    await vi.advanceTimersByTimeAsync(10);
    const noInput = sent("save")[0].msSinceInput;
    expect(typeof noInput).toBe("number");
    expect(noInput).toBeGreaterThan(2000); // never touched → far beyond the 2 s confirmation threshold
    // trusted pointer input, then a save 500 ms later
    window.dispatchEvent(trusted(new Event("pointerdown", { bubbles: true })));
    await vi.advanceTimersByTimeAsync(500);
    const ws2 = await (await w.showSaveFilePicker({ suggestedName: "b.txt" })).createWritable();
    await ws2.write(new Uint8Array([2]));
    void ws2.close();
    await vi.advanceTimersByTimeAsync(10);
    const after = sent("save")[1].msSinceInput;
    expect(after).toBeGreaterThanOrEqual(500);
    expect(after).toBeLessThan(1500);
  });
});
