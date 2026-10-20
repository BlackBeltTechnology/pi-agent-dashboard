// @vitest-environment jsdom
/**
 * Worker trampoline (design D5). Test-plan #E26 (http → one-import blob bootstrap, escaping, blob:/data:
 * pass-through) and #X5 (a trampolined worker whose import throws reaches the app's own error handling;
 * the shim reports no start-failed after opened).
 * craft-worker.js is a classic script, evaluated from source with a fake `module`.
 * See change: extend-craft-web-to-all-apps.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SRC = readFileSync(resolve(__dirname, "../craft-worker.js"), "utf8");
const SHIM_SRC = readFileSync(resolve(__dirname, "../craft-shim.js"), "utf8");

interface WorkerModule {
  bootstrapSource(abs: string, type: string): string;
  installWorkerTrampoline(win: Window): () => void;
}

function load<T>(src: string): T {
  const m: { exports: unknown } = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports as T;
}

/** Records constructions; dispatches `error` on demand like a real Worker. */
class FakeWorker extends EventTarget {
  static made: Array<{ url: string; options: unknown; self: FakeWorker }> = [];
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string | URL, options?: unknown) {
    super();
    FakeWorker.made.push({ url: String(url), options, self: this });
  }
  fail(message: string): void {
    const ev = new ErrorEvent("error", { message });
    this.onerror?.(ev);
    this.dispatchEvent(ev);
  }
}

const w = window as unknown as { Worker: unknown; URL: typeof URL };
let mod: WorkerModule;
let uninstall: () => void;
const blobs = new Map<string, Blob>();

beforeEach(() => {
  mod = load<WorkerModule>(SRC);
  FakeWorker.made = [];
  w.Worker = FakeWorker;
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    const u = `blob:https://h/${++n}`;
    blobs.set(u, b as Blob);
    return u;
  });
  window.history.replaceState(null, "", "/apps/craft-x/index.html#n=n0nce");
  uninstall = mod.installWorkerTrampoline(window);
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
  blobs.clear();
});

const bodyOf = async (url: string): Promise<string> => (blobs.get(url) as Blob).text();

describe("E26 worker trampoline", () => {
  it("module http URL → blob: bootstrap with exactly one import of the absolute URL", async () => {
    const Ctor = w.Worker as new (u: string, o?: unknown) => FakeWorker;
    new Ctor("https://h/apps/craft-x/worker.js", { type: "module" });
    const made = FakeWorker.made[0];
    expect(made.url).toMatch(/^blob:/);
    expect(made.options).toEqual({ type: "module" });
    expect(await bodyOf(made.url)).toBe('import "https://h/apps/craft-x/worker.js";');
  });

  it("classic relative URL → importScripts of the document-resolved absolute URL", async () => {
    const Ctor = w.Worker as new (u: string, o?: unknown) => FakeWorker;
    new Ctor("./worker.js");
    const body = await bodyOf(FakeWorker.made[0].url);
    expect(body).toBe(`importScripts(${JSON.stringify(new URL("./worker.js", document.baseURI).href)});`);
  });

  it("a URL carrying a quote and a newline stays ONE string literal", async () => {
    const Ctor = w.Worker as new (u: string, o?: unknown) => FakeWorker;
    const evil = 'https://h/w.js?a="+alert(1)+"\nimport "https://evil/x.js';
    new Ctor(evil, { type: "module" });
    const body = await bodyOf(FakeWorker.made[0].url);
    const abs = new URL(evil).href;
    expect(body).toBe(`import ${JSON.stringify(abs)};`);
    expect(body.split("\n")).toHaveLength(1);
    expect(body.match(/\bimport\b/g)).toHaveLength(1);
  });

  it("an URL object is accepted", async () => {
    const Ctor = w.Worker as new (u: URL, o?: unknown) => FakeWorker;
    new Ctor(new URL("https://h/apps/craft-x/w2.js"), { type: "module" });
    expect(await bodyOf(FakeWorker.made[0].url)).toBe('import "https://h/apps/craft-x/w2.js";');
  });

  it("blob: and data: URLs pass through unchanged", () => {
    const Ctor = w.Worker as new (u: string, o?: unknown) => FakeWorker;
    new Ctor("blob:https://h/abc", { type: "module" });
    new Ctor("data:text/javascript,1");
    expect(FakeWorker.made.map((m) => m.url)).toEqual(["blob:https://h/abc", "data:text/javascript,1"]);
    expect(blobs.size).toBe(0);
  });

  it("bootstrapSource escapes with JSON.stringify", () => {
    expect(mod.bootstrapSource('a"b', "module")).toBe('import "a\\"b";');
    expect(mod.bootstrapSource("x", "classic")).toBe('importScripts("x");');
  });
});

describe("X5 broken trampolined worker", () => {
  it("the app's own worker error handling runs; the shim posts no start-failed after opened", () => {
    const shimMod = load<{ createShim(win: Window, doc: Document, o?: unknown): { start(): void; dispose(): void } }>(SHIM_SRC);
    const posted: Array<{ type: string }> = [];
    vi.spyOn(window, "postMessage").mockImplementation(((m: { type: string }) => posted.push(m)) as never);
    const origWarn = console.warn;
    console.warn = () => {};
    const shim = shimMod.createShim(window, document, {
      profile: { appId: "x", title: { pattern: "^(.*) - XCraft$" }, openedFallbackMs: null, cleanOnAckedSave: true, saveName: "stem" },
    });
    shim.start();
    try {
      document.body.innerHTML = "<canvas></canvas>";
      window.dispatchEvent(new MessageEvent("message", { data: { type: "open", nonce: "n0nce", name: "a.x", bytes: new Uint8Array([1]).buffer }, source: window }));
      console.warn('Unhandled egui viewport command: Title("a.x - XCraft")');
      expect(posted.filter((m) => m.type === "opened")).toHaveLength(1);
      const Ctor = w.Worker as new (u: string, o?: unknown) => FakeWorker;
      const worker = new Ctor("https://h/apps/craft-x/broken.js", { type: "module" });
      const seen: string[] = [];
      worker.onerror = (e) => seen.push((e as ErrorEvent).message);
      worker.fail("Uncaught SyntaxError: import failed");
      expect(seen).toEqual(["Uncaught SyntaxError: import failed"]);
      expect(posted.filter((m) => m.type === "start-failed")).toHaveLength(0);
    } finally {
      shim.dispose();
      console.warn = origWarn;
    }
  });
});
