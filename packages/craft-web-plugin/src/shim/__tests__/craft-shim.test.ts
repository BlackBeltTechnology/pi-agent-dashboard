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
interface ShimModule {
  SHIM_VERSION: number;
  parseTitle(input: string | unknown[]): ParsedTitle | null;
  createShim(win: Window, doc: Document, opts?: { isTrusted?: (e: Event) => boolean }): Shim;
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
    expect(out).toEqual([{ type: "ready", nonce: NONCE }]);
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
    expect(sent("ready")).toEqual([{ type: "ready", nonce: NONCE }]);
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
    expect(sent("opened")).toEqual([{ type: "opened", nonce: NONCE, title: "report.docx" }]);
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
