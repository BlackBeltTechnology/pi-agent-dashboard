import { describe, expect, it } from "vitest";
import { ANCHOR_EPSILON, computeAnchorCorrection } from "../chat/selection-anchor.js";

/**
 * Encodes the D2 decision table of change `anchor-chat-selection-against-row-growth`.
 *
 * `correction` is the value to ADD to `scrollTop`. Positive means "scroll down",
 * which moves content up and so cancels a positive `anchorTop` shift.
 */
describe("computeAnchorCorrection", () => {
  it("compensates a row above the anchor growing inside the viewport (full delta)", () => {
    // Row above grows 800px: the anchor row's viewport top moves +800 and no
    // scroll event fired, so the whole shift is uncorrected drift.
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: 900, userScrolled: false })).toBe(800);
  });

  it("compensates a row above the anchor shrinking (negative delta)", () => {
    expect(computeAnchorCorrection({ prevTop: 400, nextTop: 100, userScrolled: false })).toBe(-300);
  });

  it("does not fight a user scroll (veto)", () => {
    // Wheel tick: content is stationary, the viewport moved. anchorTop moves by
    // -100 but a scroll event fired, so this is not drift.
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: 0, userScrolled: true })).toBe(0);
  });

  it("does not fight drag-autoscroll at the viewport edge (veto)", () => {
    expect(computeAnchorCorrection({ prevTop: 240, nextTop: 200, userScrolled: true })).toBe(0);
  });

  it("writes nothing when the virtualizer already corrected an above-viewport resize", () => {
    // TanStack's resizeItem fired for a row with start < scrollOffset and wrote
    // scrollTop itself, so by the time we measure, the anchor has not moved.
    // Safe on BOTH orderings of its async scroll event, hence both flag values.
    expect(computeAnchorCorrection({ prevTop: 320, nextTop: 320, userScrolled: false })).toBe(0);
    expect(computeAnchorCorrection({ prevTop: 320, nextTop: 320, userScrolled: true })).toBe(0);
  });

  it("treats sub-epsilon jitter as no movement (dead-band kills the feedback loop)", () => {
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: 100.4, userScrolled: false })).toBe(0);
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: 99.6, userScrolled: false })).toBe(0);
  });

  it("compensates once the shift reaches epsilon", () => {
    expect(computeAnchorCorrection({ prevTop: 0, nextTop: ANCHOR_EPSILON, userScrolled: false })).toBe(ANCHOR_EPSILON);
  });

  it("defaults epsilon to ANCHOR_EPSILON and honours an override", () => {
    expect(ANCHOR_EPSILON).toBe(1);
    // A 3px shift is drift by default, noise under a 10px dead-band.
    expect(computeAnchorCorrection({ prevTop: 0, nextTop: 3, userScrolled: false })).toBe(3);
    expect(computeAnchorCorrection({ prevTop: 0, nextTop: 3, userScrolled: false, epsilon: 10 })).toBe(0);
  });

  it("is pure — repeated calls with the same input give the same result", () => {
    const input = { prevTop: 10, nextTop: 810, userScrolled: false };
    expect(computeAnchorCorrection(input)).toBe(computeAnchorCorrection(input));
  });

  it("rejects a non-finite measurement rather than writing NaN to scrollTop", () => {
    // A detached/hidden anchor can yield NaN from a stubbed or empty rect; a NaN
    // scrollTop write would silently reset the container to 0.
    expect(computeAnchorCorrection({ prevTop: Number.NaN, nextTop: 900, userScrolled: false })).toBe(0);
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: Number.POSITIVE_INFINITY, userScrolled: false })).toBe(0);
  });
});
