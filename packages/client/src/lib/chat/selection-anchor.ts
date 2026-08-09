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
  /** Container `scrollTop` at the last baseline. */
  prevScrollTop: number;
  /** Container `scrollTop` on this commit. */
  nextScrollTop: number;
  /** Dead-band override; defaults to {@link ANCHOR_EPSILON}. */
  epsilon?: number;
}

/**
 * How far to move `scrollTop` so the anchor row returns to where it was.
 *
 * The two signals do two DIFFERENT jobs, and conflating them is the trap:
 *
 *   - **Magnitude** is `Δtop = nextTop − prevTop` — viewport-relative movement
 *     of the anchor. Positive means content pushed it down, so scrolling down
 *     by the same amount cancels it.
 *   - **Discriminator** is `Δtop + Δscroll`. It is ~0 exactly when the viewport
 *     moved over stationary content (a user scroll or drag-autoscroll, where the
 *     two deltas are anti-correlated by construction). Anything else — a real
 *     resize, or the virtualizer's own above-viewport correction — leaves a
 *     non-zero sum.
 *
 * `Δscroll` CANNOT be the magnitude. Writing the correction as
 * `α·Δtop + β·Δscroll`, the decision table forces α = β (user scroll → 0),
 * α = 1 (in-viewport growth → G, hence β = 1), and β = 0 (above-viewport growth
 * the virtualizer already corrected → 0). No linear formula satisfies all three.
 * Splitting the roles — magnitude from `Δtop`, veto from the sum — does.
 *
 * Deliberately STATELESS. An earlier revision vetoed on a "did a scroll event
 * fire?" boolean; that flag cannot distinguish the virtualizer's programmatic
 * `scrollToFn` write from a user gesture, and a stale flag silently skipped a
 * genuine compensation for good (the drift is then absorbed by the next
 * baseline). Geometry cannot go stale.
 */
export function computeAnchorCorrection({
  prevTop,
  nextTop,
  prevScrollTop,
  nextScrollTop,
  epsilon,
}: AnchorCorrectionInput): number {
  if (![prevTop, nextTop, prevScrollTop, nextScrollTop].every(Number.isFinite)) return 0;
  const residual = nextTop - prevTop;
  const band = epsilon ?? ANCHOR_EPSILON;
  // Pure viewport move: the user (or drag-autoscroll) moved the view over
  // stationary content. Never fight it.
  if (Math.abs(residual + (nextScrollTop - prevScrollTop)) < band) return 0;
  return Math.abs(residual) < band ? 0 : residual;
}
