/**
 * Reducer compaction-metadata capture + the pure badge derivers.
 *
 * The reducer captures `reason` / `willRetry` / `estimatedPostCompactionTokens`
 * from `session_compact` (pi 0.79.8/0.79.10+); absent fields leave state
 * unchanged. The label deriver + reduction abbreviation are pure functions.
 *
 * See change: adopt-pi-074-080-features (C.1 — E6, E7).
 */
import { describe, expect, it } from "vitest";
import {
  abbreviateTokens,
  compactionReasonLabel,
  createInitialState,
  deriveCompactionBadge,
  reduceEvent,
} from "../chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ev(data: Record<string, unknown>): DashboardEvent {
  return { eventType: "session_compact", timestamp: 1000, data } as DashboardEvent;
}

describe("E6: reducer captures compaction metadata", () => {
  it.each([["manual"], ["threshold"], ["overflow"]] as const)(
    "stores reason=%s, willRetry, and estimate exactly",
    (reason) => {
      const s = reduceEvent(createInitialState(), ev({ reason, willRetry: true, estimatedPostCompactionTokens: 7600 }));
      expect(s.compaction).toMatchObject({
        reason,
        willRetry: true,
        estimatedPostCompactionTokens: 7600,
      });
    },
  );

  it("snapshots preCompactionTokens from the current contextUsage", () => {
    const start = { ...createInitialState(), contextUsage: { tokens: 20000, contextWindow: 200000 } };
    const s = reduceEvent(start, ev({ reason: "threshold", estimatedPostCompactionTokens: 7600 }));
    expect(s.compaction?.preCompactionTokens).toBe(20000);
  });

  it("legacy event with no new fields stores nothing new (behaves as today)", () => {
    const s = reduceEvent(createInitialState(), ev({}));
    expect(s.compaction).toBeUndefined();
    // The compaction marker message is still appended (today's behavior).
    expect(s.messages.at(-1)?.content).toContain("compacted");
  });

  it("ignores an unknown reason value", () => {
    const s = reduceEvent(createInitialState(), ev({ reason: "bogus", willRetry: false }));
    expect(s.compaction?.reason).toBeUndefined();
    expect(s.compaction?.willRetry).toBe(false);
  });
});

describe("E7: compactionReasonLabel (pure)", () => {
  it("maps each reason to its label", () => {
    expect(compactionReasonLabel("manual")).toBe("manual");
    expect(compactionReasonLabel("threshold")).toBe("auto-threshold");
    expect(compactionReasonLabel("overflow")).toBe("overflow-retry");
  });
});

describe("abbreviateTokens (pure)", () => {
  it("abbreviates thousands with one decimal, dropping trailing .0", () => {
    expect(abbreviateTokens(12400)).toBe("12.4k");
    expect(abbreviateTokens(8000)).toBe("8k");
    expect(abbreviateTokens(800)).toBe("800");
    expect(abbreviateTokens(1500)).toBe("1.5k");
  });
});

describe("deriveCompactionBadge (pure)", () => {
  it("F6 shape: threshold + 12,400 reduction → auto-threshold −12.4k", () => {
    const badge = deriveCompactionBadge({
      reason: "threshold",
      preCompactionTokens: 20000,
      estimatedPostCompactionTokens: 7600,
    });
    expect(badge).toEqual({ label: "auto-threshold", reductionText: "\u221212.4k" });
  });

  it("returns null when there is no reason (nothing to annotate)", () => {
    expect(deriveCompactionBadge(undefined)).toBeNull();
    expect(deriveCompactionBadge({ willRetry: true })).toBeNull();
  });

  it("label only (empty reduction) when token counts are missing", () => {
    expect(deriveCompactionBadge({ reason: "manual" })).toEqual({ label: "manual", reductionText: "" });
  });

  it("no reduction text when the delta is non-positive", () => {
    const badge = deriveCompactionBadge({
      reason: "overflow",
      preCompactionTokens: 5000,
      estimatedPostCompactionTokens: 6000,
    });
    expect(badge).toEqual({ label: "overflow-retry", reductionText: "" });
  });
});
