/**
 * E39 (test-plan) — check: fit uses a 4% safe margin.
 *
 * Pure rule: `fitFindings` flags a content rect whose edge crosses the safe
 * margin. At 1920x1080 with the 4% default the right edge limit is
 * 1920 * (1 - 0.04) = 1843.2: a rect ending at 1843 passes, one ending at 1844
 * produces `error fit … right 1844px > 1843px` (threshold rounded for display)
 * with the `overrides.slides["<id>"].diagram.scale` suggestion.
 */
import { describe, expect, it } from "vitest";
import { fitFindings, formatFinding, type Measurement, type SlideRef } from "../rules.js";

const SLIDE: SlideRef = { id: "arch", index: 2 };
const VIEWPORT = { w: 1920, h: 1080 };

function box(id: string, x: number, y: number, w: number, h: number): Measurement {
  return { kind: "label", id, text: id, rect: { x, y, w, h }, capHeight: 20 };
}

describe("check fit rule applies the 4% safe margin (E39)", () => {
  it("uses a 1843.2px right edge limit and passes a rect ending at 1843", () => {
    const findings = fitFindings([box("A", 100, 100, 1743, 100)], VIEWPORT, SLIDE);
    expect(findings).toHaveLength(0);
  });

  it("brackets the 1843.2 limit (strict >)", () => {
    // right 1843.19 < 1843.2 → inside; 1844 crosses it.
    expect(fitFindings([box("A", 100, 100, 1743.19, 100)], VIEWPORT, SLIDE)).toHaveLength(0);
    expect(fitFindings([box("A", 100, 100, 1743.3, 100)], VIEWPORT, SLIDE)).toHaveLength(1);
  });

  it("flags right 1844px > 1843px with a diagram.scale suggestion", () => {
    const findings = fitFindings([box("A", 100, 100, 1744, 100)], VIEWPORT, SLIDE);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe("error");
    expect(f.rule).toBe("fit");
    expect(f.slide).toBe("arch");
    expect(f.slideIndex).toBe(2);
    expect(formatFinding(f)).toBe("error fit slide 2 right 1844px > 1843px");
    expect(f.measured).toBe("1844px");
    expect(f.threshold).toBe("1843px");
    expect(f.detail).toBe("right 1844px > 1843px");
    expect(f.suggest).toBe('overrides.slides["arch"].diagram.scale');
  });

  it("applies the same margin to the left, top and bottom edges", () => {
    // 4% of 1920 = 76.8 (left), 4% of 1080 = 43.2 (top/bottom).
    expect(fitFindings([box("L", 76.8, 500, 10, 10)], VIEWPORT, SLIDE)).toHaveLength(0);
    expect(fitFindings([box("L", 76.7, 500, 10, 10)], VIEWPORT, SLIDE)[0]?.detail).toContain("left 77px < 77px");
    expect(fitFindings([box("T", 500, 43.2, 10, 10)], VIEWPORT, SLIDE)).toHaveLength(0);
    expect(fitFindings([box("T", 500, 43.1, 10, 10)], VIEWPORT, SLIDE)[0]?.detail).toContain("top 43px < 43px");
    expect(fitFindings([box("B", 500, 1026.8, 10, 10)], VIEWPORT, SLIDE)).toHaveLength(0);
    expect(fitFindings([box("B", 500, 1026.9, 10, 10)], VIEWPORT, SLIDE)[0]?.detail).toContain("bottom 1037px > 1037px");
  });
});
