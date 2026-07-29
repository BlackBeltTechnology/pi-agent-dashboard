/**
 * Unit tests for the read-time spend-decoration choke point.
 *
 * Covers test-plan rows E5–E8 (sum / empty / costless / unresolvable), X1
 * (throwing lookup), X4 (cold-start self-heal), and the purity invariant that
 * underpins X2 (input records are never mutated).
 *
 * See change: fix-goal-detail-turns-and-spend.
 */
import type { GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { decorateGoalsWithSpend, type SpendSessionLookup } from "../goal/decorate-goals-spend.js";

function goal(over: Partial<GoalRecord> & { sessionIds: string[] }): GoalRecord {
  return {
    id: "g1",
    cwd: "/repo",
    objective: "Ship it",
    criteria: [],
    status: "pursuing",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** Session lookup backed by a plain map of id → cost. */
function lookup(costs: Record<string, number | undefined>): SpendSessionLookup {
  return { get: (sid) => (sid in costs ? { cost: costs[sid] } : undefined) };
}

describe("decorateGoalsWithSpend", () => {
  it("E5: sums cost over linked sessions → 0.39", () => {
    const out = decorateGoalsWithSpend([goal({ sessionIds: ["a", "b"] })], lookup({ a: 0.1, b: 0.29 }));
    expect(out[0]!.totalSpendUsd).toBeCloseTo(0.39, 10);
  });

  it("E6: no sessions → 0", () => {
    const out = decorateGoalsWithSpend([goal({ sessionIds: [] })], lookup({}));
    expect(out[0]!.totalSpendUsd).toBe(0);
  });

  it("E7: session resolves with cost undefined → contributes 0", () => {
    const out = decorateGoalsWithSpend([goal({ sessionIds: ["a", "b"] })], lookup({ a: 0.29, b: undefined }));
    expect(out[0]!.totalSpendUsd).toBeCloseTo(0.29, 10);
  });

  it("E8: unresolvable id (get→undefined) → 0, no throw", () => {
    const out = decorateGoalsWithSpend([goal({ sessionIds: ["missing"] })], lookup({}));
    expect(out[0]!.totalSpendUsd).toBe(0);
  });

  it("X1: a throwing lookup for one sid contributes 0; others still sum", () => {
    const sessions: SpendSessionLookup = {
      get: (sid) => {
        if (sid === "boom") throw new Error("lookup blew up");
        return { cost: 0.29 };
      },
    };
    const out = decorateGoalsWithSpend([goal({ sessionIds: ["good", "boom"] })], sessions);
    expect(out[0]!.totalSpendUsd).toBeCloseTo(0.29, 10);
  });

  it("X4: cold-start self-heal — 0 before scan, 0.39 after", () => {
    const g = goal({ sessionIds: ["a", "b"] });
    const before = decorateGoalsWithSpend([g], lookup({ a: 0, b: 0 }));
    expect(before[0]!.totalSpendUsd).toBe(0);
    const after = decorateGoalsWithSpend([g], lookup({ a: 0.1, b: 0.29 }));
    expect(after[0]!.totalSpendUsd).toBeCloseTo(0.39, 10);
  });

  it("purity: returns new objects and never mutates the input record", () => {
    const input = goal({ sessionIds: ["a"] });
    const out = decorateGoalsWithSpend([input], lookup({ a: 0.29 }));
    expect(out[0]).not.toBe(input);
    expect("totalSpendUsd" in input).toBe(false);
    expect(input.totalSpendUsd).toBeUndefined();
  });
});
