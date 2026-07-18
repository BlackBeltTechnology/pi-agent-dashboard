import { describe, expect, it } from "vitest";
import { clampWidth, ratioFromPointer } from "../layout/useSplitRatio.js";
import { RATIO_MAX, RATIO_MIN } from "../layout/split-state.js";

describe("ratioFromPointer", () => {
  it("computes the fraction along a horizontal container", () => {
    // container spans x∈[100, 900] (width 800); pointer at 500 → midpoint.
    expect(ratioFromPointer("h", 500, { start: 100, size: 800 })).toBeCloseTo(0.5);
  });

  it("computes the fraction along a vertical container", () => {
    expect(ratioFromPointer("v", 400, { start: 200, size: 400 })).toBeCloseTo(0.5);
  });

  it("clamps to the minimum when the pointer is near the start edge", () => {
    expect(ratioFromPointer("h", 110, { start: 100, size: 800 })).toBe(RATIO_MIN);
  });

  it("clamps to the maximum when the pointer is near the end edge", () => {
    expect(ratioFromPointer("h", 880, { start: 100, size: 800 })).toBe(RATIO_MAX);
  });

  it("guards against a zero-size container", () => {
    const r = ratioFromPointer("h", 500, { start: 100, size: 0 });
    expect(r).toBeGreaterThanOrEqual(RATIO_MIN);
    expect(r).toBeLessThanOrEqual(RATIO_MAX);
  });
});

describe("clampWidth", () => {
  it("passes through a width in range", () => {
    expect(clampWidth(240, 160, 480)).toBe(240);
  });

  it("clamps below the minimum", () => {
    expect(clampWidth(100, 160, 480)).toBe(160);
  });

  it("clamps above the maximum", () => {
    expect(clampWidth(900, 160, 480)).toBe(480);
  });
});
