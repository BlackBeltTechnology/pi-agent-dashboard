/**
 * jsdom shim for the windowed chat transcript (TanStack Virtual).
 *
 * jsdom has no layout engine and no `ResizeObserver`, so TanStack Virtual reads
 * the scroll container's `offsetHeight` as 0 once at mount and renders ZERO rows
 * — breaking every per-row content assertion in ChatView unit tests. Those tests
 * validate rendered OUTPUT, not scroll/windowing behaviour (that layer is
 * Playwright-gated, per the virtualize-chat-transcript-tanstack design's Test
 * Strategy).
 *
 * This shim, loaded via `setupFiles`, does the minimum to let the virtualizer
 * mount its rows under jsdom:
 *   1. Provides a no-op `ResizeObserver` (TanStack guards for its absence, but a
 *      constructor must exist for the observe path in other components).
 *   2. Reports a very tall `offsetHeight` for ONLY the ChatView scroll container
 *      (matched by `data-testid="chat-scroll-container"`; TanStack's `getRect`
 *      reads `offsetWidth`/`offsetHeight`). Rows still measure 0 (their offsets
 *      are untouched), so ALL rows fall inside the tall window and mount. No
 *      other element's layout is altered.
 *
 * See change: virtualize-chat-transcript-tanstack (task 10.2 / test infra).
 */
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Global RTL cleanup: unmount every rendered tree after each test so React's
// concurrent scheduler can't flush work AFTER the vitest fork's jsdom teardown
// (`ReferenceError: window is not defined` in performWorkOnRootViaSchedulerTask
// → the run exits 1 even when every assertion passed). ~40 client specs render
// without their own cleanup; test-file scheduling under pool:forks shifts which
// one is active when the leaked work fires, so a per-file fix is whack-a-mole.
// No client spec renders in `beforeAll`, so no test relies on cross-`it` tree
// persistence — a global unmount is safe. See change: friendlier-worktree-init.
// Letting what is ALREADY scheduled run is the other half of the same problem,
// and `cleanup()` alone does not cover it. TanStack Virtual notifies through a
// `setTimeout`-based debounce (`virtual-core/utils.js`), so a notify can still
// be in flight when a test ends; it then reaches React's dispatch after the
// fork's jsdom is gone:
//
//   ReferenceError: window is not defined
//     ❯ resolveUpdatePriority  react-dom-client
//     ❯ Virtualizer.notify      @tanstack/virtual-core
//     ❯ Timeout._onTimeout      @tanstack/virtual-core/utils.js
//
// Vitest reports that as `Errors 1` and the run exits 1 with every assertion
// passing. Which spec gets blamed depends on `pool:"forks"` scheduling, so it is
// a suite-level flake rather than a bug in that file. Yielding one macrotask
// after `cleanup()` lets the pending notify fire while `window` still exists,
// against an already-unmounted tree, which is a no-op. Deliberately a yield and
// NOT a global `setTimeout` wrapper that cancels pending ids: that also
// intercepts `user-event`'s and fake timers' own scheduling and broke the
// clipboard-fallback spec.
// See change: fix-tmux-session-shutdown-leak.
afterEach(async () => {
  cleanup();
  // Only with REAL timers: under `vi.useFakeTimers()` nothing advances the
  // clock here, so awaiting a timeout would hang the hook until the test
  // timeout (measured: five package-queue specs at 10 s each).
  if (vi.isFakeTimers()) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
});

configure({ asyncUtilTimeout: 5_000 });

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const TALL_VIEWPORT = 100_000;
const WIDE_VIEWPORT = 1_000;

function isChatScroller(el: unknown): boolean {
  return el instanceof Element && el.getAttribute("data-testid") === "chat-scroll-container";
}

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return isChatScroller(this) ? TALL_VIEWPORT : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return isChatScroller(this) ? WIDE_VIEWPORT : 0;
  },
});
