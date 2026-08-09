/**
 * Pure anchor arithmetic for the selection-anchoring compensator
 * (change: anchor-chat-selection-against-row-growth, D5).
 *
 * No DOM access, no React. `ChatView` owns the plumbing — read the rect, call
 * this, conditionally write `scrollTop`, re-baseline — so the D2 decision table
 * is directly executable in vitest. jsdom has no layout engine, so this is the
 * only layer where the arithmetic can be asserted for real; the wiring is
 * verified by Playwright.
 */

/**
 * Dead-band, in CSS px. Sub-pixel rect noise (device pixel ratio, transforms)
 * must not sustain a correct→re-measure→correct feedback loop.
 */
export const ANCHOR_EPSILON = 1;

export interface AnchorCorrectionInput {
  /** Anchor row's viewport-relative `top` at the last baseline. */
  prevTop: number;
  /** Anchor row's viewport-relative `top` measured on this commit. */
  nextTop: number;
  /**
   * D2 veto: a real `scroll` event fired since the last baseline, so the
   * viewport moved rather than the content. Re-baseline, never compensate.
   */
  userScrolled: boolean;
  /** Dead-band override; defaults to {@link ANCHOR_EPSILON}. */
  epsilon?: number;
}

/**
 * How far to move `scrollTop` so the anchor row returns to where it was.
 *
 * `residual = nextTop − prevTop` — viewport-relative movement of the anchor.
 * Positive means content pushed the anchor down, so scrolling down by the same
 * amount cancels it.
 *
 * Deliberately does NOT take a scroll delta. Summing one is unsatisfiable: a
 * programmatic scroll (TanStack's above-viewport `resizeItem` correction) and a
 * user scroll present identical `(Δtop, Δscroll)` pairs, so any linear formula
 * that ignores a user scroll must also double-correct an above-viewport resize.
 * `userScrolled` supplies that missing bit from outside the arithmetic. See D2.
 */
export function computeAnchorCorrection({ prevTop, nextTop, userScrolled, epsilon }: AnchorCorrectionInput): number {
  if (userScrolled) return 0;
  if (!Number.isFinite(prevTop) || !Number.isFinite(nextTop)) return 0;
  const residual = nextTop - prevTop;
  const band = epsilon ?? ANCHOR_EPSILON;
  return Math.abs(residual) < band ? 0 : residual;
}
