/**
 * Layout constants and row classification for the chat pane (`split-chat-pane`).
 *
 * Below the floor sum, height is allocated across the rows that can give (shrinkable)
 * rather than clipped off the bottom-most row. A row is shrinkable ONLY if it owns
 * a scrollport, so losing height hides content behind a scrollbar rather than outside
 * its box. Every other row is fixed (keeps `shrink-0`).
 *
 * See change: define-chat-pane-below-floor-allocation.
 */

export type ChatPaneRowClass = "shrinkable" | "fixed";

export interface ShrinkableRowSpec {
  rowClass: "shrinkable";
  /** Declared floor / flex-basis (px). */
  floor: number;
  /** Hard lower bound (px). Must be strictly less than `floor`. */
  bound: number;
  /** Flex-shrink factor / allocation weight. */
  weight: number;
}

export interface FixedRowSpec {
  rowClass: "fixed";
  /** Content-determined height. */
  bound: "content";
}

export type ChatPaneRowSpec = ShrinkableRowSpec | FixedRowSpec;

/**
 * Declared floor and bounds for the transcript (`ChatView`).
 *
 * Floor (flex-basis): 64px (~2 message lines) — the transcript's share of the floor sum.
 * Bound (min-height): 16px — hard lower bound, TanStack Virtual measures viewport.
 * Weight (flex-shrink): 3 — transcript gives first because scrolling preserves access.
 */
export const CHAT_TRANSCRIPT_FLOOR = 64;
export const CHAT_TRANSCRIPT_BOUND = 16;
export const CHAT_TRANSCRIPT_WEIGHT = 3;

/**
 * Declared bounds and weight for the composer (`composer-root`).
 *
 * Bound (min-height): 72px — 38px textarea + root p-3 + card padding + border.
 * Weight (flex-shrink): 1.
 * Cap: max-h-[40%] (stays in place).
 */
export const CHAT_COMPOSER_BOUND = 72;
export const CHAT_COMPOSER_WEIGHT = 1;

/**
 * Single source of truth for row classifications in `split-chat-pane`.
 * Covers every row rendered by `App.tsx` into the chat pane, including conditionals.
 */
export const CHAT_PANE_ROW_TABLE: Record<string, ChatPaneRowSpec> = {
  // Shrinkable rows (own a scrollport)
  "chat-view": {
    rowClass: "shrinkable",
    floor: CHAT_TRANSCRIPT_FLOOR,
    bound: CHAT_TRANSCRIPT_BOUND,
    weight: CHAT_TRANSCRIPT_WEIGHT,
  },
  "composer-root": {
    rowClass: "shrinkable",
    // Base height is dynamic (min(content, 0.4 * pane)), bound is 72px.
    // For floor vs bound validation, the base must be > bound (72).
    floor: CHAT_COMPOSER_BOUND + 1, // nominal base > bound
    bound: CHAT_COMPOSER_BOUND,
    weight: CHAT_COMPOSER_WEIGHT,
  },

  // Fixed rows (hold content height, shrink-0)
  "content-header-sticky": {
    rowClass: "fixed",
    bound: "content",
  },
  "error-boundary-fallback": {
    rowClass: "fixed",
    bound: "content",
  },
  "session-banner": {
    rowClass: "fixed",
    bound: "content",
  },
  "composer-context-strip": {
    rowClass: "fixed",
    bound: "content",
  },
  "status-bar": {
    rowClass: "fixed",
    bound: "content",
  },
  "queue-panel": {
    rowClass: "fixed",
    bound: "content",
  },
  "content-inline-footer": {
    rowClass: "fixed",
    bound: "content",
  },
};
