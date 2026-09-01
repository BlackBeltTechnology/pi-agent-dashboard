/**
 * Overlay z-index ratchet (test-plan #E4, #E5).
 *
 * #E4 — a NEW raw z-index (not in the frozen baseline) fails the gate.
 * #E5 — removing a baselined raw-z (portaling it) is allowed; the ceiling only
 *        shrinks.
 * Also guards that word-based layer utilities (`z-popover`) are NOT flagged.
 *
 * See change: add-overlay-layering-system.
 */
import { describe, expect, it } from "vitest";
import { extractRawZ, ratchetDecision, scanRawZ } from "../z-layer-lint.mjs";

describe("z-layer ratchet — token detection", () => {
  it("matches raw numeric z, ignores word-based layer utilities", () => {
    const src = 'className="fixed z-popover z-50 z-[9999] z-dialog z-[60]"';
    expect(extractRawZ(src).sort()).toEqual(["z-50", "z-[60]", "z-[9999]"].sort());
    // No numeric-z tokens at all → empty.
    expect(extractRawZ('className="fixed z-popover z-dialog z-toast"')).toEqual([]);
  });
});

describe("z-layer ratchet — decision (test-plan #E4/#E5)", () => {
  const baseline = { "a.tsx|z-50": 1, "b.tsx|z-[60]": 2 };

  it("#E4 rejects a NEW raw-z occurrence not covered by the baseline", () => {
    const files = ["a.tsx", "c.tsx"];
    const read = (f) => (f === "a.tsx" ? "z-50" : "z-[123]"); // c.tsx introduces z-[123]
    const current = scanRawZ(files, read);
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(false);
    expect(additions.map((a) => a.key)).toContain("c.tsx|z-[123]");
  });

  it("#E4 rejects an INCREASED count of an already-baselined token", () => {
    const current = { "b.tsx|z-[60]": 3 }; // baseline allows 2
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(false);
    expect(additions[0]).toMatchObject({ key: "b.tsx|z-[60]", baseline: 2, current: 3 });
  });

  it("#E5 allows shrinking — a removed/reduced baselined token passes", () => {
    const current = { "a.tsx|z-50": 1 }; // b.tsx z-[60] portaled away entirely
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(true);
    expect(additions).toEqual([]);
  });
});
