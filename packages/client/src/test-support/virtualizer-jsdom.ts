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
import { configure } from "@testing-library/react";

// Under the full parallel suite, CPU oversubscription (pool:"forks",
// maxWorkers 50%) starves async work, so `waitFor` / `findBy*` polls can exceed
// their 1000ms default before an effect, mock call, or state update lands — a
// flake that passes in isolation (EditorFileTree, ...). Raise the global
// async-util timeout so healthy assertions stop tripping under load; a
// genuinely missing update still fails, just later.
// See change: fix-flaky-full-suite-tests.
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
