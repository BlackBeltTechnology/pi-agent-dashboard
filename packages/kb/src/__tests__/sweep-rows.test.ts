// Tests for change: fix-kb-search-lane-composition — paired-fixture reporting
// in the lane-lead sweep (design D6).
// Folded from openspec/changes/fix-kb-search-lane-composition/test-plan.md (E13).
import { describe, expect, it } from "vitest";
import { buildPairedRow, PAIRED_SETS } from "../../eval/sweep-rows.js";
import type { EvalMetrics } from "../eval.js";

const metrics = (over: Partial<EvalMetrics> = {}): EvalMetrics => ({
  n: 100,
  "P@1": 0.1,
  "P@5": 0.2,
  "Recall@K": 0.3,
  MRR: 0.15,
  "nDCG@K": 0.2,
  distinctSourcesAtK: 9,
  duplicateSlotShare: 0,
  singleSourcePageRate: 0,
  avgLatencyMs: 1,
  unreachable: 0,
  ...over,
});

describe("E13: a sweep row must report BOTH golden sets", () => {
  it("emits a metric group per fixture, keyed by set name", () => {
    const row = buildPairedRow("laneLeadMargin=0.2", new Map([
      ["source-intent", metrics({ "P@1": 0.19 })],
      ["markdown-intent", metrics({ "P@1": 0.14 })],
    ]));
    expect(row.variant).toBe("laneLeadMargin=0.2");
    for (const set of PAIRED_SETS) {
      expect(row[`${set} P@1`], `missing ${set} metric group`).toBeDefined();
      expect(row[`${set} MRR`]).toBeDefined();
      expect(row[`${set} n`]).toBe(100);
    }
    expect(row["source-intent P@1"]).toBe(0.19);
    expect(row["markdown-intent P@1"]).toBe(0.14);
  });

  it.each(PAIRED_SETS)("throws when the %s fixture is missing — never a silent cell", (missing) => {
    const present = PAIRED_SETS.filter((s) => s !== missing).map((s) => [s, metrics()] as const);
    expect(() => buildPairedRow("laneLeadMargin=0.3", new Map(present))).toThrow(
      new RegExp(`laneLeadMargin=0\\.3.*${missing}`),
    );
  });

  it("throws when a fixture scored zero items — an empty group is not evidence", () => {
    expect(() =>
      buildPairedRow("laneLeadMargin=0.5", new Map([
        ["source-intent", metrics({ n: 0 })],
        ["markdown-intent", metrics()],
      ])),
    ).toThrow(/source-intent/);
  });
});
