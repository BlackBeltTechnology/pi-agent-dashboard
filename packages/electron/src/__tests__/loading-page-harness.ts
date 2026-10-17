/**
 * Test harness: run the inline script of `resources/loading.html` in a `node:vm`
 * context with a stub DOM, so a test can drive its poll loop with fake timers and
 * observe exactly which navigation calls it makes.
 *
 * See change: fix-pairing-approval-credential (test-plan #P2, #E63, #X16).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOADING_HTML = path.resolve(here, "..", "..", "resources", "loading.html");

interface StubElement {
  style: Record<string, string>;
  textContent: string;
  disabled: boolean;
  open: boolean;
  innerHTML: string;
  listeners: Record<string, Array<() => unknown>>;
  addEventListener(type: string, fn: () => unknown): void;
  querySelector(sel: string): StubElement;
  appendChild(el: StubElement): void;
}

function makeEl(): StubElement {
  const el: StubElement = {
    style: {},
    textContent: "",
    disabled: false,
    open: false,
    innerHTML: "",
    listeners: {},
    addEventListener(type, fn) { (el.listeners[type] ??= []).push(fn); },
    querySelector: () => makeEl(),
    appendChild: () => {},
  };
  return el;
}

export function loadingScript(): string {
  const html = readFileSync(LOADING_HTML, "utf-8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return scripts[scripts.length - 1]![1]!;
}

export interface LoadingPageOptions {
  /** Raw `location.search`, e.g. `?serverUrl=http%3A%2F%2F10.0.0.5%3A8000`. */
  search?: string;
  piDashboard?: Record<string, unknown>;
  fetchImpl?: (url: string, init?: unknown) => Promise<{ ok: boolean }>;
}

export interface LoadingPage {
  els: Record<string, StubElement>;
  /** Elements the page created with `document.createElement` (e.g. known-server buttons). */
  created: StubElement[];
  /** Every value assigned to `location.href` — must stay empty for dashboard targets. */
  hrefAssignments: string[];
}

/** Call AFTER `vi.useFakeTimers()` so the page's `setTimeout` is the fake one. */
export function runLoadingPage(opts: LoadingPageOptions = {}): LoadingPage {
  const els: Record<string, StubElement> = {};
  const created: StubElement[] = [];
  const hrefAssignments: string[] = [];
  const location = {
    search: opts.search ?? "",
    get href() { return "file:///loading.html"; },
    set href(v: string) { hrefAssignments.push(v); },
  };
  const document = {
    getElementById: (id: string) => (els[id] ??= makeEl()),
    createElement: () => { const e = makeEl(); created.push(e); return e; },
  };
  const win: Record<string, unknown> = { piDashboard: opts.piDashboard };
  const ctx = vm.createContext({
    window: win,
    location,
    document,
    URL,
    URLSearchParams,
    atob,
    AbortSignal,
    JSON,
    Promise,
    fetch: opts.fetchImpl ?? (async () => ({ ok: false })),
    setTimeout: (fn: () => unknown, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  vm.runInContext(loadingScript(), ctx);
  return { els, created, hrefAssignments };
}
