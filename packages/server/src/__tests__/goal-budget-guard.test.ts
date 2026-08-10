/**
 * Tests for dashboard-side goal budget enforcement.
 *
 * See change: sophisticate-goal-authoring-and-control (task 3.2).
 */
import { describe, it, expect } from "vitest";
import { decideBudgetHalt } from "../goal/goal-budget-guard.js";

describe("decideBudgetHalt", () => {
  it("halts an active loop once turnsUsed reaches the cap", () => {
    expect(decideBudgetHalt({ status: "active", turnsUsed: 20 }, { maxTurns: 20 })).toEqual({
      halt: true,
      command: "/goal pause",
    });
    expect(decideBudgetHalt({ status: "active", turnsUsed: 25 }, { maxTurns: 20 }).halt).toBe(true);
  });

  it("does not halt below the cap", () => {
    expect(decideBudgetHalt({ status: "active", turnsUsed: 19 }, { maxTurns: 20 }).halt).toBe(false);
  });

  it("never halts a non-active loop", () => {
    expect(decideBudgetHalt({ status: "paused", turnsUsed: 99 }, { maxTurns: 20 }).halt).toBe(false);
    expect(decideBudgetHalt({ status: "done", turnsUsed: 99 }, { maxTurns: 20 }).halt).toBe(false);
  });

  it("never halts without a usable cap", () => {
    expect(decideBudgetHalt({ status: "active", turnsUsed: 99 }, undefined).halt).toBe(false);
    expect(decideBudgetHalt({ status: "active", turnsUsed: 99 }, {}).halt).toBe(false);
    expect(decideBudgetHalt({ status: "active", turnsUsed: 99 }, { maxTurns: 0 }).halt).toBe(false);
  });
});
