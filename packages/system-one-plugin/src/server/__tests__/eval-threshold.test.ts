// @vitest-environment node
/**
 * Threshold derivation (design D13) boundary: the accuracy-maximising cut may
 * lie above every observed score (all-negative fixtures). Review finding.
 * See change: add-system-one-registry.
 */
import { describe, expect, it } from "vitest";
import { bestThreshold } from "../eval.js";

describe("bestThreshold", () => {
  it("can place the cut above every score so all-negative fixtures classify perfectly", () => {
    const pairs = [0.6, 0.7, 0.8].map((score) => ({ score, label: false }));
    const cut = bestThreshold(pairs) as number;
    expect(pairs.every((p) => p.score >= cut === p.label)).toBe(true);
  });
  it("can place the cut at/below every score for all-positive fixtures", () => {
    const pairs = [0.2, 0.3].map((score) => ({ score, label: true }));
    const cut = bestThreshold(pairs) as number;
    expect(pairs.every((p) => p.score >= cut === p.label)).toBe(true);
  });
  it("ties prefer the cut closest to 0.5", () => {
    expect(bestThreshold([{ score: 0.1, label: false }, { score: 0.9, label: true }])).toBe(0.5);
  });
});
