/**
 * Recommended pin bump 0.83.0 → 0.84.1: the recommended bump must surface an
 * upgrade HINT (not a hard block) for pi at/above minimum but below recommended,
 * no hint at exactly recommended, and the below-minimum gate still applies.
 *
 * The upgrade-hint boundary sits at 0.84.0 / 0.84.1: 0.84.1 is a patch over
 * 0.84.0 with no breaking change, so 0.84.0 users get a hint and never a block.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #E5-#E6).
 */
import { describe, expect, it } from "vitest";
import { computeCompatibility } from "../pi/pi-version-skew.js";

const RANGE = { minimum: "0.78.0", recommended: "0.84.1", maximum: null };

describe("pi-version-skew — recommended 0.84.1", () => {
  it("E5: pi 0.84.0 (>= min, < recommended) → upgrade hint, not a block", () => {
    const out = computeCompatibility(RANGE, "0.84.0");
    expect(out.upgradeRecommended).toBe(true);
    expect(out.error).toBeUndefined(); // no hard block
  });

  it("E5: pi exactly at recommended 0.84.1 → no upgrade hint", () => {
    const out = computeCompatibility(RANGE, "0.84.1");
    expect(out.upgradeRecommended).toBeFalsy();
    expect(out.error).toBeUndefined();
  });

  it("E5: the whole 0.78.x–0.84.0 band hints without blocking", () => {
    for (const v of ["0.78.0", "0.80.10", "0.83.0", "0.84.0"]) {
      const out = computeCompatibility(RANGE, v);
      expect(out.upgradeRecommended, `${v} should hint`).toBe(true);
      expect(out.error, `${v} must not block`).toBeUndefined();
    }
  });

  it("E6: pi 0.77.999 (< minimum 0.78.0) → below-minimum gate (error populated)", () => {
    const out = computeCompatibility(RANGE, "0.77.999");
    expect(out.error).toBeTruthy();
    expect(out.error).toContain("0.78.0");
  });

  it("E6: pi exactly at minimum 0.78.0 → no error, hint only", () => {
    const out = computeCompatibility(RANGE, "0.78.0");
    expect(out.error).toBeUndefined();
    expect(out.upgradeRecommended).toBe(true);
  });
});
