/**
 * E38 (test-plan) — check: label overlap uses an IoU threshold of 0.1.
 *
 * Pure rule: `overlapFindings` fires strictly above IoU 0.1 (epsilon-guarded
 * against the exact boundary). Two unit squares are offset so their intersection
 * gives exactly the target IoU: IoU = t / (2 - t) with t the overlap width.
 * 0.1 → no finding; 0.1001 → one `error overlap` naming both ids.
 */
import { describe, expect, it } from "vitest";
import { iou, overlapFindings, type Measurement, type Rect, type SlideRef } from "../rules.js";

const SLIDE: SlideRef = { id: "arch", index: 2 };

function label(id: string, rect: Rect): Measurement {
  return { kind: "label", id, text: id, rect, capHeight: 20 };
}

/** Two unit squares whose horizontal overlap yields exactly `target` IoU. */
function pairAtIou(target: number): [Measurement, Measurement] {
  const t = (2 * target) / (1 + target);
  return [label("A", { x: 0, y: 0, w: 1, h: 1 }), label("B", { x: 1 - t, y: 0, w: 1, h: 1 })];
}

describe("check overlap rule fires strictly above IoU 0.1 (E38)", () => {
  it("reports no finding at exactly IoU 0.1", () => {
    const pair = pairAtIou(0.1);
    expect(iou(pair[0].rect, pair[1].rect)).toBeCloseTo(0.1, 6);
    expect(overlapFindings(pair, SLIDE)).toHaveLength(0);
  });

  it("reports error overlap naming both ids at IoU 0.1001", () => {
    const pair = pairAtIou(0.1001);
    expect(iou(pair[0].rect, pair[1].rect)).toBeCloseTo(0.1001, 6);

    const findings = overlapFindings(pair, SLIDE);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe("error");
    expect(f.rule).toBe("overlap");
    expect(f.slide).toBe("arch");
    expect(f.slideIndex).toBe(2);
    expect(f.id).toBe("A");
    // Both ids are named by the finding.
    expect(f.text).toBe("A ∩ B");
    expect(f.text).toContain("A");
    expect(f.text).toContain("B");
    expect(f.detail).toContain("A ∩ B");
    expect(f.detail).toContain("> 0.1");
    expect(f.suggest).toBe('overrides.nodes["arch/A"].position');
  });

  it("does not pair a label with a non-text node", () => {
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    const mixed: Measurement[] = [label("A", rect), { kind: "node", id: "N", text: "", rect, capHeight: 0 }];
    expect(overlapFindings(mixed, SLIDE)).toHaveLength(0);
  });
});
