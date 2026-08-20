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
// TanStack Virtual 3.13.12's element-offset observer leaves its default
// 150 ms scroll-reset callback scheduled after unmount. Under full-suite load it can fire after
// jsdom removes `window`, so wait it out only for tests that mounted ChatView.
// Do not wrap or cancel global timers: that breaks user-event and fake-timer
// tests. See changes: fix-tmux-session-shutdown-leak,
// restore-dashboard-subagents-dependency.
let chatScrollerSeen = false;

afterEach(async () => {
  const hadChatScroller = chatScrollerSeen;
  cleanup();
  chatScrollerSeen = false;
  if (vi.isFakeTimers() || !hadChatScroller) return;
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

function isChatScroller(el: unknown): boolean {
  const matches = el instanceof Element && el.getAttribute("data-testid") === "chat-scroll-container";
  if (matches) chatScrollerSeen = true;
  return matches;
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
