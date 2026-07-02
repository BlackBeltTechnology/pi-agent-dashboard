/**
 * In-app depth-tagged navigation tracker for the depth-aware mobile back action.
 *
 * Browsers cannot read the previous history entry's URL (security), so "is the
 * predecessor a strictly-shallower in-app route?" is unanswerable by inspection.
 * This module tracks the app's own navigation as a stack of `{ url, depth }`:
 *   - `recordNavigation(url)` appends (deduping consecutive identical urls to
 *     survive React StrictMode double-invoke);
 *   - `recordNavigation(url, { replace: true })` overwrites the stack top to
 *     mirror a wouter `replace` (real history mutation, not a push);
 *   - a single `popstate` listener realigns the stack on browser back/forward;
 *   - `initNavTracker` also patches `history.pushState`/`replaceState` so
 *     navigations that bypass App's wrapped `navigate` (plugin components using
 *     wouter's raw `useLocation`, session-card routing, `<Link>`) still record.
 *     Without this the tracker never sees them and `goBack` cannot prove a
 *     shallower in-app predecessor — the run-monitor "back goes home" bug.
 *     See change: fix-plugin-and-scoped-back-navigation.
 *
 * `predecessor()` returns the last-but-one entry, which `goBack` uses to decide
 * between a `window.history.back()` fast-path and explicit parent navigation.
 *
 * Treat the stack as a hint: `goBack` only upgrades to `history.back()` when the
 * predecessor proves shallower, else falls back to `computeBackTarget`, so drift
 * degrades to "still correct, just pushes instead of pops".
 *
 * See change: fix-mobile-back-depth-aware.
 */
import { routeDepth } from "./back-target.js";

export interface NavEntry {
  url: string;
  depth: number;
}

let stack: NavEntry[] = [];

/** Reset the stack; optionally seed with an initial URL (e.g. cold-load location). */
export function resetNavStack(initialUrl?: string): void {
  stack = [];
  if (initialUrl !== undefined) recordNavigation(initialUrl);
}

/** Append a navigation, or overwrite the stack top for `replace`-style nav. */
export function recordNavigation(url: string, opts?: { replace?: boolean }): void {
  const entry: NavEntry = { url, depth: routeDepth(url) };
  if (opts?.replace) {
    if (stack.length === 0) stack.push(entry);
    else stack[stack.length - 1] = entry;
    return;
  }
  const top = stack[stack.length - 1];
  if (top && top.url === url) return; // dedupe consecutive (StrictMode guard)
  stack.push(entry);
}

/** The last-but-one entry, or undefined when the stack has < 2 entries. */
export function predecessor(): NavEntry | undefined {
  return stack.length >= 2 ? stack[stack.length - 2] : undefined;
}

/** Drop the top entry (used after a `history.back()` fast-path). */
export function popNav(): void {
  stack.pop();
}

/**
 * Realign the stack after a browser back/forward.
 *
 * If `url` matches the predecessor, it was a back → pop the top. Otherwise it is
 * a forward or out-of-band navigation → record it.
 */
export function handlePopState(url: string): void {
  const pred = stack[stack.length - 2];
  if (pred && pred.url === url) {
    stack.pop();
    return;
  }
  recordNavigation(url);
}

/** Current location as the tracker records it (path + query). */
function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

let activeListener: (() => void) | null = null;

let historyPatched = false;
let restoreHistory: (() => void) | null = null;

/**
 * Monkeypatch `history.pushState`/`replaceState` to record every navigation.
 *
 * Composes over any prior patch (wouter patches these too, to dispatch its own
 * location events): the original bound method is called first, then the new
 * `window.location` is recorded. Idempotent — a second call while already
 * patched returns the existing restore fn. Restore is idempotent too.
 */
function patchHistory(): () => void {
  if (historyPatched) return restoreHistory ?? (() => {});
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    origPush(data, unused, url);
    recordNavigation(currentUrl());
  };
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    origReplace(data, unused, url);
    recordNavigation(currentUrl(), { replace: true });
  };
  historyPatched = true;
  restoreHistory = () => {
    if (!historyPatched) return;
    window.history.pushState = origPush;
    window.history.replaceState = origReplace;
    historyPatched = false;
    restoreHistory = null;
  };
  return restoreHistory;
}

/**
 * Attach the single popstate listener + the history-observation patch; returns
 * a detach fn that tears both down.
 *
 * Idempotent: a prior listener (e.g. from a StrictMode double-invoke that did
 * not run its cleanup) is detached first so only one listener is ever active.
 */
export function initNavTracker(): () => void {
  if (activeListener) {
    window.removeEventListener("popstate", activeListener);
    activeListener = null;
  }
  const listener = () => handlePopState(currentUrl());
  window.addEventListener("popstate", listener);
  activeListener = listener;
  const restore = patchHistory();
  return () => {
    if (activeListener === listener) {
      window.removeEventListener("popstate", listener);
      activeListener = null;
    }
    restore();
  };
}
