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
// TanStack Virtual 3.13.12's element-offset observer leaves its default 150 ms
// scroll-reset callback scheduled after unmount. Under full-suite load it can
// fire after jsdom removes `window`, and then reaches React's dispatch:
//
//   ReferenceError: window is not defined
//     ❯ resolveUpdatePriority  react-dom-client
//     ❯ Virtualizer.notify      @tanstack/virtual-core
//     ❯ Timeout._onTimeout      @tanstack/virtual-core/utils.js
//
// Vitest reports that as `Errors 1` and the run exits 1 with EVERY assertion
// passing. Which spec gets blamed depends on `pool: "forks"` scheduling, so it
// presents as a suite-level flake rather than a bug in the blamed file.
//
// Waiting the callback out lets it fire against an already-unmounted tree while
// `window` still exists, which is a no-op. Deliberately NOT a global
// `setTimeout` wrapper cancelling pending ids: that also intercepts
// `user-event`'s and fake timers' own scheduling and broke the
// clipboard-fallback spec.
//
// INVARIANT: the wait is scoped to the scroll containers listed in
// `DRAINED_TESTIDS`, so that list must cover every `useVirtualizer` call site.
// A site rendering some other testid would leave its own callback scheduled and
// silently reintroduce the flake. Enforced by
// `packages/shared/src/__tests__/virtualizer-drain-scope.test.ts` — widen this
// list rather than editing that lint's expectations.
// See changes: fix-tmux-session-shutdown-leak,
// restore-dashboard-subagents-dependency.
const DRAINED_TESTIDS = ["chat-scroll-container"];

// Set by `noteScrollerAccess` below. The virtualizer probing a drained
// container is the only signal that a drain-worthy tree mounted this test.
let drainPending = false;

afterEach(async () => {
  const needsDrain = drainPending;
  cleanup();
  drainPending = false;
  if (vi.isFakeTimers() || !needsDrain) return;
  await new Promise((resolve) => setTimeout(resolve, 160));
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

function isDrainedScroller(el: unknown): boolean {
  if (!(el instanceof Element)) return false;
  const testid = el.getAttribute("data-testid");
  return testid !== null && DRAINED_TESTIDS.includes(testid);
}

// Named for its effect, not as an `is*` predicate: it BOTH answers the layout
// question and arms the `afterEach` drain. Getter access is the only hook we
// get — the virtualizer reads `offsetHeight`/`offsetWidth` when it measures,
// including on a later manual unmount.
function noteScrollerAccess(el: unknown): boolean {
  const matches = isDrainedScroller(el);
  if (matches) drainPending = true;
  return matches;
}

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return noteScrollerAccess(this) ? TALL_VIEWPORT : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return noteScrollerAccess(this) ? WIDE_VIEWPORT : 0;
  },
});
