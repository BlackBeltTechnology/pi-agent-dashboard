import { describe, expect, it } from "vitest";
import { ANCHOR_EPSILON, computeAnchorCorrection } from "../chat/selection-anchor.js";

/**
 * Encodes the D2 decision table of change `anchor-chat-selection-against-row-growth`.
 *
 * `correction` is the value to ADD to `scrollTop`. Positive means "scroll down",
 * which moves content up and so cancels a positive `anchorTop` shift.
 *
 * Two signals, two distinct jobs:
 *   - `Δtop` is the correction MAGNITUDE.
 *   - `Δtop + Δscroll` is only a DISCRIMINATOR: it is ~0 exactly when the
 *     viewport moved over stationary content (user scroll, drag-autoscroll).
 * Using `Δscroll` as magnitude is provably unsatisfiable — see the module doc.
 */
describe("computeAnchorCorrection", () => {
  const at = (prevTop: number, nextTop: number, prevScrollTop = 0, nextScrollTop = 0) =>
    computeAnchorCorrection({ prevTop, nextTop, prevScrollTop, nextScrollTop });

  it("compensates a row above the anchor growing inside the viewport (full delta)", () => {
    // Row above grows 800px: the anchor slides down 800 and the viewport did
    // not move, so the whole shift is uncorrected drift.
    expect(at(100, 900)).toBe(800);
  });

  it("compensates a row above the anchor shrinking (negative delta)", () => {
    expect(at(400, 100)).toBe(-300);
  });

  it("does not fight a user scroll", () => {
    // Wheel down 100: content stationary, viewport moved. Δtop and Δscroll are
    // exactly anti-correlated, which is the signature of a pure viewport move.
    expect(at(100, 0, 5_000, 5_100)).toBe(0);
  });

  it("does not fight drag-autoscroll at the viewport edge", () => {
    expect(at(240, 200, 1_000, 1_040)).toBe(0);
  });

  it("writes nothing when the virtualizer already corrected an above-viewport resize", () => {
    // `resizeItem` moved BOTH the content and scrollTop by the delta, so the
    // anchor never moved. Δscroll is large, but Δtop — the magnitude — is 0.
    // This must NOT be mistaken for a user scroll: the sum is +800, not ~0.
    expect(at(320, 320, 5_000, 5_800)).toBe(0);
  });

  it("compensates a real growth even when the virtualizer also scrolled in the same window", () => {
    // The regression CodeRabbit caught: a virtualizer correction (+800 scroll,
    // anchor-neutral) plus a genuine in-viewport growth (+300). A stateful
    // "did a scroll event fire?" veto skips the 300 forever; the geometric
    // discriminator sees sum = 300 + 800 ≠ 0 and still compensates.
    expect(at(100, 400, 5_000, 5_800)).toBe(300);
  });

  it("treats sub-epsilon jitter as no movement (dead-band kills the feedback loop)", () => {
    expect(at(100, 100.4)).toBe(0);
    expect(at(100, 99.6)).toBe(0);
  });

  it("compensates once the shift reaches epsilon", () => {
    expect(at(0, ANCHOR_EPSILON)).toBe(ANCHOR_EPSILON);
  });

  it("defaults epsilon to ANCHOR_EPSILON and honours an override", () => {
    expect(ANCHOR_EPSILON).toBe(1);
    expect(at(0, 3)).toBe(3);
    expect(computeAnchorCorrection({ prevTop: 0, nextTop: 3, prevScrollTop: 0, nextScrollTop: 0, epsilon: 10 })).toBe(0);
  });

  it("is pure — repeated calls with the same input give the same result", () => {
    const input = { prevTop: 10, nextTop: 810, prevScrollTop: 0, nextScrollTop: 0 };
    expect(computeAnchorCorrection(input)).toBe(computeAnchorCorrection(input));
  });

  it("rejects a non-finite measurement rather than writing NaN to scrollTop", () => {
    // A NaN scrollTop write silently resets the container to 0.
    expect(at(Number.NaN, 900)).toBe(0);
    expect(at(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(computeAnchorCorrection({ prevTop: 100, nextTop: 900, prevScrollTop: Number.NaN, nextScrollTop: 0 })).toBe(0);
  });
});
