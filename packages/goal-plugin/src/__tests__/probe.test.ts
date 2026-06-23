/**
 * Tests for the goal command-surface probe + config-command seam.
 *
 * See change: sophisticate-goal-authoring-and-control (task 3.1).
 */
import { describe, it, expect } from "vitest";
import {
  probeGoalCommandSurface,
  goalConfigCommand,
  tierEnforcesBudgetDashboardSide,
} from "../server/probe.js";

describe("probeGoalCommandSurface", () => {
  it("picks full tier when the extension accepts config", () => {
    expect(probeGoalCommandSurface({ acceptsConfig: true })).toBe("full");
  });
  it("picks dashboard-budget tier when only subgoal is accepted", () => {
    expect(probeGoalCommandSurface({ acceptsSubgoal: true })).toBe("criteria-dashboard-budget");
  });
  it("picks intent-only for an unknown/absent surface", () => {
    expect(probeGoalCommandSurface(null)).toBe("intent-only");
    expect(probeGoalCommandSurface(undefined)).toBe("intent-only");
    expect(probeGoalCommandSurface({})).toBe("intent-only");
  });
});

describe("goalConfigCommand", () => {
  it("emits a config command only in the full tier", () => {
    const cmd = goalConfigCommand("full", {
      judge: { provider: "anthropic", modelId: "claude" },
      budget: { maxTurns: 30, maxSpendUsd: 5 },
    });
    expect(cmd).toBe("/goal config --judge anthropic/claude --max-turns 30 --max-spend 5");
  });
  it("returns null in non-full tiers", () => {
    expect(goalConfigCommand("criteria-dashboard-budget", { budget: { maxTurns: 5 } })).toBeNull();
    expect(goalConfigCommand("intent-only", { judge: { provider: "p", modelId: "m" } })).toBeNull();
  });
  it("returns null in full tier when there is nothing to configure", () => {
    expect(goalConfigCommand("full", {})).toBeNull();
  });
});

describe("tierEnforcesBudgetDashboardSide", () => {
  it("is true only for the degraded dashboard-budget tier", () => {
    expect(tierEnforcesBudgetDashboardSide("criteria-dashboard-budget")).toBe(true);
    expect(tierEnforcesBudgetDashboardSide("full")).toBe(false);
    expect(tierEnforcesBudgetDashboardSide("intent-only")).toBe(false);
  });
});
