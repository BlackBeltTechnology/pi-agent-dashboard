import { describe, expect, it } from "vitest";
import { computeFitScale, intrinsicSize } from "../mermaid-fit.js";

const svg = (attrs: string) => `<svg ${attrs}><g/></svg>`;

// See change: fix-markdown-remount-storm (test-plan E15-E19, X1, X2)
describe("computeFitScale", () => {
  it("width-constrained (E16)", () => expect(computeFitScale(svg('viewBox="0 0 800 400"'), 600, 420)).toBeCloseTo(0.75));
  it("height-constrained (E17)", () => expect(computeFitScale(svg('viewBox="0 0 400 1200"'), 600, 420)).toBeCloseTo(0.35));
  it("very tall returns raw (<0.5) — hook clamps (E15)", () =>
    expect(computeFitScale(svg('viewBox="0 0 800 2000"'), 600, 420)).toBeCloseTo(0.21));
  it("width=100% + max-width style uses viewBox, not 1.0 (E18)", () =>
    expect(computeFitScale(svg('width="100%" style="max-width:800px" viewBox="0 0 800 400"'), 600, 420)).toBeCloseTo(0.75));
  it("absolute width/height without viewBox (E19)", () =>
    expect(computeFitScale(svg('width="1200px" height="600"'), 600, 420)).toBeCloseTo(0.5));
  it("unknown size falls back to 1, no NaN (X1)", () => expect(computeFitScale(svg(""), 600, 420)).toBe(1));
  it("malformed viewBox falls through (X2)", () => {
    expect(intrinsicSize(svg('viewBox="0 0 abc 400" width="800" height="400"'))).toEqual({ w: 800, h: 400 });
    expect(computeFitScale(svg('viewBox="0 0 abc 400"'), 600, 420)).toBe(1);
  });
  it("zero viewport falls back to 1", () => expect(computeFitScale(svg('viewBox="0 0 800 400"'), 0, 0)).toBe(1));
});
