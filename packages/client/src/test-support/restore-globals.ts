/**
 * Vitest `setupFiles` hygiene: undo what a test file leaves behind on the shared jsdom
 * environment, so a file's result does not depend on which files ran before it in the same
 * worker (the precondition for `isolate: false`, and for `--sequence.shuffle`).
 *
 * After every TEST: Testing-Library cleanup, an empty `document.body`, real timers (a leaked
 * `vi.useFakeTimers()` stalls every later file).
 * After every FILE (`afterAll`): the original `localStorage` / `sessionStorage` objects and
 * contents, `Element.prototype.getBoundingClientRect`, `window.matchMedia`, an empty `<head>`.
 *
 * It deliberately does NOT call `vi.resetModules()` / `vi.clearAllMocks()`: resetting modules
 * after React was imported hands the test file a second React copy ("Invalid hook call"), and
 * clearing mocks breaks files that assert cumulative call counts across tests.
 *
 * See change: test-trust-audit (design D6).
 */
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";

const originalStorage = {
  local: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
  session: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
};
const originalWindowStorage = {
  local: Object.getOwnPropertyDescriptor(window, "localStorage"),
  session: Object.getOwnPropertyDescriptor(window, "sessionStorage"),
};
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const originalMatchMedia = (window as { matchMedia?: typeof window.matchMedia }).matchMedia;

/** Put every global the suite is known to replace back; exported for the hygiene test. */
export function restoreGlobals(): void {
  for (const [name, key] of [["local", "localStorage"], ["session", "sessionStorage"]] as const) {
    const g = originalStorage[name];
    if (g) Object.defineProperty(globalThis, key, g);
    const w = originalWindowStorage[name];
    if (w) Object.defineProperty(window, key, w);
  }
  try {
    globalThis.localStorage?.clear?.();
    globalThis.sessionStorage?.clear?.();
  } catch {
    // A test left a storage that throws; the descriptors above were already restored.
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete (window as { matchMedia?: unknown }).matchMedia;
}

// Per TEST: DOM + timers. A file may install a global stub once (module level / beforeAll) and
// rely on it for every test, so the globals below are restored per FILE, not per test.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  restoreGlobals();
});
