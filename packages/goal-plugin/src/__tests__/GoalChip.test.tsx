/**
 * Render matrix for GoalChip across each goal status, fed through the real
 * plugin per-session event store (publishSessionEvent) the shell uses.
 *
 * See change: add-goal-continuation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  publishSessionEvent,
  clearSessionEvents,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GoalChip } from "../client/GoalChip.js";
import { detailsToSnapshot, GOAL_STATUS_EVENT_TYPE, type GoalHermesEventDetails } from "../shared/goal-types.js";

afterEach(cleanup);

const session = { id: "s1", cwd: "/repo", source: "dashboard", status: "active" } as unknown as DashboardSession;

const renderChip = () =>
  render(
    <PluginContextProvider>
      <GoalChip session={session} />
    </PluginContextProvider>,
  );

function emit(over: Partial<GoalHermesEventDetails>): void {
  const snap = detailsToSnapshot({
    eventType: "goal-set", goal: "Ship it", status: "active",
    turnsUsed: 0, maxTurns: 20, lastVerdict: null, lastReason: null, pausedReason: null,
    ...over,
  });
  publishSessionEvent("s1", { eventType: GOAL_STATUS_EVENT_TYPE, timestamp: Date.now(), data: snap as unknown as Record<string, unknown> });
}

describe("GoalChip", () => {
  afterEach(() => clearSessionEvents("s1"));

  it("renders nothing when no goal snapshot exists", () => {
    const { container } = renderChip();
    expect(container.querySelector("[data-testid='goal-chip']")).toBeNull();
  });

  it("renders `● Pursuing n/m` when active", () => {
    emit({ eventType: "goal-continuing", turnsUsed: 4 });
    const { getByTestId } = renderChip();
    expect(getByTestId("goal-chip").textContent).toContain("Pursuing 4/20");
  });

  it("renders `⏸ Paused · reason` when paused", () => {
    emit({ eventType: "goal-paused", pausedReason: "budget exhausted" });
    const { getByTestId } = renderChip();
    expect(getByTestId("goal-chip").textContent).toContain("Paused · budget exhausted");
  });

  it("renders `✓ Achieved` when done", () => {
    emit({ eventType: "goal-achieved" });
    const { getByTestId } = renderChip();
    expect(getByTestId("goal-chip").textContent).toContain("Achieved");
  });

  it("hides after the goal is cleared", () => {
    emit({ eventType: "goal-continuing", turnsUsed: 2 });
    emit({ eventType: "goal-cleared" });
    const { container } = renderChip();
    expect(container.querySelector("[data-testid='goal-chip']")).toBeNull();
  });
});
