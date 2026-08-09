# selection-anchor.ts — index

Pure anchor arithmetic for the selection-anchoring compensator. No DOM, no
React — `ChatView` owns the plumbing (read rect, call this, conditionally write
`scrollTop`, re-baseline). See change: anchor-chat-selection-against-row-growth.

## Exports

- `ANCHOR_EPSILON = 1` — dead-band in CSS px. Sub-pixel rect noise (device pixel
  ratio, transforms) must not sustain a correct → re-measure → correct loop.
- `AnchorCorrectionInput` — `{ prevTop, nextTop, prevScrollTop, nextScrollTop, epsilon? }`.
- `computeAnchorCorrection(input) => number` — px to ADD to `scrollTop` so the
  selection's anchor row returns to where it was.

## Contract

Two signals, two DIFFERENT jobs. Conflating them is the trap this module exists
to prevent:

- **Magnitude** = `nextTop - prevTop` (viewport-relative movement of the anchor).
- **Discriminator** = `magnitude + (nextScrollTop - prevScrollTop)`. Approx `0`
  only when the viewport moved over stationary content (user scroll,
  drag-autoscroll), where the two deltas are anti-correlated by construction.

Returns `0` when: any input is non-finite (a NaN `scrollTop` write silently
resets the container to 0); the discriminator is within the dead-band (pure
viewport move); or the magnitude is within the dead-band.

## Do not "simplify" this

- Do NOT use the scroll delta as the correction magnitude. Writing the
  correction as `a*dTop + b*dScroll`, the decision table forces `a = b` (user
  scroll to 0), `a = 1` (in-viewport growth to G, hence `b = 1`), and `b = 0`
  (above-viewport growth the virtualizer already corrected, to 0). No linear
  formula satisfies all three. Splitting the roles does.
- Do NOT reintroduce a stateful veto. An earlier revision gated on a "did a
  `scroll` event fire?" boolean; it cannot tell TanStack's programmatic
  `scrollToFn` write (`virtual-core@3.13.12 index.cjs:536-541`) from a user
  gesture, and a stale flag skipped a genuine compensation permanently (the
  drift is then absorbed by the next baseline). Caught in review on PR #439;
  regression test: "still compensates a real growth after a programmatic
  (virtualizer) scroll event".
- Do NOT classify resizes as above/in-viewport. That mirrors a library internal
  and silently re-arms the double-move (D1).
