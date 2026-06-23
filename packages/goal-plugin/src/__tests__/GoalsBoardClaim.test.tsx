/**
 * GoalsBoardClaim (Screen B) — enriched cards + delete affordance.
 * Verifies a card shows the live turn ring + verdict (task 5.3) and the card
 * delete overflow confirms before calling DELETE (task 5.5).
 *
 * See change: sophisticate-goal-authoring-and-control.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import {
  PluginContextProvider,
  publishSessionEvent,
  clearSessionEvents,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GoalsBoardClaim } from "../client/GoalsBoardClaim.js";
import { encodeFolderPath } from "../client/goals-api.js";
import { GOAL_STATUS_EVENT_TYPE } from "../shared/goal-types.js";

const cwd = "/repo/alpha";

function goalFixture(over: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id: "g1", cwd, objective: "Ship goals", criteria: [], status: "pursuing",
    sessionIds: ["d1"], driverSessionId: "d1", createdAt: 1, updatedAt: 1, ...over,
  } as GoalRecord;
}

let deletes: string[];
function mockFetch(goals: GoalRecord[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { deletes.push(url); return { ok: true, json: async () => ({ success: true }) } as Response; }
    return { ok: true, json: async () => ({ success: true, data: goals }) } as Response;
  });
}

beforeEach(() => { deletes = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); clearSessionEvents("d1"); });

function renderBoard(goals: GoalRecord[]) {
  (globalThis as any).fetch = mockFetch(goals);
  return render(
    <Router>
      <PluginContextProvider>
        <GoalsBoardClaim params={{ encodedCwd: encodeFolderPath(cwd) }} onBack={() => {}} />
      </PluginContextProvider>
    </Router>,
  );
}

describe("GoalsBoardClaim", () => {
  it("shows the live turn ring and verdict on a card", async () => {
    publishSessionEvent("d1", {
      eventType: GOAL_STATUS_EVENT_TYPE,
      timestamp: Date.now(),
      data: { status: "active", goal: "Ship goals", turnsUsed: 6, maxTurns: 20, lastVerdict: "continue", lastReason: null },
    });
    const { getByTestId } = renderBoard([goalFixture()]);
    await waitFor(() => getByTestId("goal-card"));
    expect(getByTestId("goal-turn-ring")).toBeTruthy();
    expect(getByTestId("goal-card-verdict").textContent).toContain("continue");
  });

  it("confirms before deleting a card and calls DELETE", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { getByTestId } = renderBoard([goalFixture()]);
    await waitFor(() => getByTestId("goal-card-delete"));
    fireEvent.click(getByTestId("goal-card-delete"));
    await waitFor(() => expect(deletes.length).toBe(1));
    expect(deletes[0]).toContain("/api/folders/goals/g1");
  });

  it("does not delete a card when confirm is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByTestId } = renderBoard([goalFixture()]);
    await waitFor(() => getByTestId("goal-card-delete"));
    fireEvent.click(getByTestId("goal-card-delete"));
    await new Promise((r) => setTimeout(r, 20));
    expect(deletes.length).toBe(0);
  });
});
