/**
 * E37 (test-plan) — check: legibility is scaled by viewport.
 *
 * Pure rule: `legibilityFindings(measurements, viewportH, slide)` flags a label
 * whose measured cap height is strictly below `14 * viewportH / 1080`.
 * Boundary values: 1080 → threshold 14.00 (14 passes, 13.99 warns);
 * 720 → threshold 9.33̅ (9.34 passes, 9.33 warns).
 */
import { describe, expect, it } from "vitest";
import { legibilityFindings, type Measurement, type SlideRef } from "../rules.js";

const SLIDE: SlideRef = { id: "arch", index: 2 };

function label(id: string, capHeight: number): Measurement {
  return {
    kind: "label",
    id,
    text: id,
    rect: { x: 100, y: 100, w: 40, h: capHeight },
    capHeight,
  };
}

describe("check legibility rule scales the 14px minimum by viewport height (E37)", () => {
  it("passes 14 and warns 13.99 at 1920x1080 (threshold 14.00px)", () => {
    const findings = legibilityFindings([label("pass", 14), label("warn", 13.99)], 1080, SLIDE);

    expect(findings.map((f) => f.id)).toEqual(["warn"]);
    const [f] = findings;
    expect(f.severity).toBe("warn");
    expect(f.rule).toBe("legibility");
    expect(f.slide).toBe("arch");
    expect(f.slideIndex).toBe(2);
    expect(f.measured).toBe("13.99px");
    expect(f.threshold).toBe("14.00px");
    expect(f.detail).toBe("13.99px < 14.00px");
    expect(f.suggest).toBe('overrides.slides["arch"].labels.size');
  });

  it("passes 9.34 and warns 9.33 at 1280x720 (threshold 14*720/1080 = 9.33̅px)", () => {
    const findings = legibilityFindings([label("pass", 9.34), label("warn", 9.33)], 720, SLIDE);

    expect(findings.map((f) => f.id)).toEqual(["warn"]);
    const [f] = findings;
    expect(f.severity).toBe("warn");
    expect(f.measured).toBe("9.33px");
    // 9.33̅ rounds to 9.33 for display; the warn fires because 9.33 is below it.
    expect(f.threshold).toBe("9.33px");
    expect(f.suggest).toBe('overrides.slides["arch"].labels.size');
  });

  it("treats cap height exactly at the scaled threshold as passing", () => {
    const exact = (14 * 720) / 1080; // 9.333…
    expect(legibilityFindings([label("pass", exact)], 720, SLIDE)).toHaveLength(0);
    expect(legibilityFindings([label("warn", exact - 1e-9)], 720, SLIDE).map((f) => f.id)).toEqual(["warn"]);
  });

  it("only considers text measurements (labels/titles with text)", () => {
    const node: Measurement = { kind: "node", id: "N", text: "", rect: { x: 0, y: 0, w: 5, h: 5 }, capHeight: 1 };
    expect(legibilityFindings([node], 1080, SLIDE)).toHaveLength(0);
  });
});
