/**
 * GoalControl dispatch matrix: each control emits the expected `plugin_action`
 * (captured via setSender) for the current goal status.
 *
 * See change: add-goal-continuation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  publishSessionEvent,
  clearSessionEvents,
  PluginContextProvider,
  setSender,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GoalControl } from "../client/GoalControl.js";
import { detailsToSnapshot, GOAL_STATUS_EVENT_TYPE, type GoalHermesEventDetails } from "../shared/goal-types.js";

const session = { id: "s1", cwd: "/repo", source: "dashboard", status: "active" } as unknown as DashboardSession;
let sent: any[] = [];

beforeEach(() => {
  sent = [];
  setSender((m) => sent.push(m));
});
afterEach(() => {
  cleanup();
  clearSessionEvents("s1");
  setSender(null);
});

function emit(over: Partial<GoalHermesEventDetails>): void {
  const snap = detailsToSnapshot({
    eventType: "goal-set", goal: "Ship it", status: "active",
    turnsUsed: 0, maxTurns: 20, lastVerdict: null, lastReason: null, pausedReason: null,
    ...over,
  });
  publishSessionEvent("s1", { eventType: GOAL_STATUS_EVENT_TYPE, timestamp: Date.now(), data: snap as unknown as Record<string, unknown> });
}

const renderControl = () =>
  render(
    <PluginContextProvider>
      <GoalControl session={session} />
    </PluginContextProvider>,
  );

describe("GoalControl dispatch", () => {
  it("empty state: Enter on the input dispatches set with the goal text", () => {
    const { getByPlaceholderText } = renderControl();
    const input = getByPlaceholderText("Set a goal…");
    fireEvent.change(input, { target: { value: "Get CI green" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sent).toEqual([
      { type: "plugin_action", pluginId: "goal", sessionId: "s1", action: "set", payload: { goal: "Get CI green" } },
    ]);
  });

  it("active state: Pause / Done / Clear dispatch their actions", () => {
    emit({ eventType: "goal-continuing", turnsUsed: 3 });
    const { getByText } = renderControl();
    fireEvent.click(getByText("⏸ Pause"));
    fireEvent.click(getByText("✓ Done"));
    fireEvent.click(getByText("Clear"));
    expect(sent.map((m) => m.action)).toEqual(["pause", "done", "clear"]);
    expect(sent.every((m) => m.pluginId === "goal" && m.sessionId === "s1")).toBe(true);
  });

  it("paused state: Resume + Clear, no Pause/Done", () => {
    emit({ eventType: "goal-paused", pausedReason: "budget" });
    const { getByText, queryByText } = renderControl();
    expect(queryByText("⏸ Pause")).toBeNull();
    fireEvent.click(getByText("▶ Resume"));
    fireEvent.click(getByText("Clear"));
    expect(sent.map((m) => m.action)).toEqual(["resume", "clear"]);
  });
});
