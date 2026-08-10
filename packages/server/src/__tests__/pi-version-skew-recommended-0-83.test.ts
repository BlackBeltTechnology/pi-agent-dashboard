/**
 * Recommended pin bump 0.81.1 → 0.83.0: the recommended bump must surface an
 * upgrade HINT (not a hard block) for pi at/above minimum but below recommended,
 * no hint at exactly recommended, and the below-minimum gate still applies.
 *
 * See change: update-pi-core-0-83-adopt-apis (test-plan #E5-#E7).
 */
import { describe, expect, it } from "vitest";
import { computeCompatibility } from "../pi/pi-version-skew.js";

const RANGE = { minimum: "0.78.0", recommended: "0.83.0", maximum: null };

describe("pi-version-skew — recommended 0.83.0", () => {
  it("E5: pi 0.81.1 (>= min, < recommended) → upgrade hint, not a block", () => {
    const out = computeCompatibility(RANGE, "0.81.1");
    expect(out.upgradeRecommended).toBe(true);
    expect(out.error).toBeUndefined(); // no hard block
  });

  it("E6: pi exactly at recommended 0.83.0 → no upgrade hint", () => {
    const out = computeCompatibility(RANGE, "0.83.0");
    expect(out.upgradeRecommended).toBeFalsy();
    expect(out.error).toBeUndefined();
  });

  it("E7: pi 0.77.0 (< minimum 0.78.0) → below-minimum gate (error populated)", () => {
    const out = computeCompatibility(RANGE, "0.77.0");
    expect(out.error).toBeTruthy();
    expect(out.error).toContain("0.78.0");
  });
});
