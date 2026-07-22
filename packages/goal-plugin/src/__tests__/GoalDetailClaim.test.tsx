/**
 * GoalDetailClaim (Screen C) — loop controls, verdict timeline, delete.
 * Verifies pause dispatches plugin_action (task 5.1), the verdict timeline
 * renders newest-first + empty state (task 5.2), and delete confirm/cancel +
 * post-delete navigation (task 5.5).
 *
 * See change: sophisticate-goal-authoring-and-control.
 */

import {
  PluginContextProvider,
  setSender,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

type PluginActionMessage = { pluginId: string; sessionId: string | null; action: string; payload?: Record<string, unknown> };

import type { GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GoalDetailClaim } from "../client/GoalDetailClaim.js";
import { encodeFolderPath, goalsBoardUrl } from "../client/goals-api.js";

const cwd = "/repo/alpha";

function goalFixture(over: Partial<GoalRecord> = {}): GoalRecord {
  return {
    id: "g1", cwd, objective: "Ship goals", criteria: [], status: "pursuing",
    sessionIds: ["d1"], driverSessionId: "d1", createdAt: 1, updatedAt: 1, ...over,
  } as GoalRecord;
}

let deletes: string[];
function mockFetch(goal: GoalRecord) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { deletes.push(url); return { ok: true, json: async () => ({ success: true }) } as Response; }
    if (url.startsWith("/api/folders/goals")) return { ok: true, json: async () => ({ success: true, data: [goal] }) } as Response;
    return { ok: true, json: async () => ({ success: true, data: { labels: [] } }) } as Response;
  });
}

beforeEach(() => { deletes = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); setSender(null); });

function renderDetail(goal: GoalRecord, hook?: any) {
  (globalThis as any).fetch = mockFetch(goal);
  return render(
    <Router hook={hook}>
      <PluginContextProvider>
        <GoalDetailClaim params={{ encodedCwd: encodeFolderPath(cwd), goalId: goal.id }} onBack={() => {}} />
      </PluginContextProvider>
    </Router>,
  );
}

describe("GoalDetailClaim", () => {
  it("dispatches a pause plugin_action to the driver session", async () => {
    const sent: PluginActionMessage[] = [];
    setSender((m) => sent.push(m));
    const { getByTestId } = renderDetail(goalFixture());
    await waitFor(() => getByTestId("goal-ctl-pause"));
    fireEvent.click(getByTestId("goal-ctl-pause"));
    expect(sent).toContainEqual(expect.objectContaining({ pluginId: "goal", sessionId: "d1", action: "pause" }));
  });

  it("renders the verdict timeline newest-first", async () => {
    const goal = goalFixture({
      verdicts: [
        { turn: 1, at: 1000, verdict: "continue" },
        { turn: 2, at: 2000, verdict: "satisfied" },
      ],
    });
    const { getAllByTestId } = renderDetail(goal);
    await waitFor(() => expect(getAllByTestId("goal-verdict-row").length).toBe(2));
    const rows = getAllByTestId("goal-verdict-row");
    expect(rows[0]!.textContent).toContain("t2");
    expect(rows[0]!.textContent).toContain("satisfied");
    expect(rows[1]!.textContent).toContain("t1");
  });

  it("shows an empty verdict state when none recorded", async () => {
    const { getByTestId } = renderDetail(goalFixture());
    await waitFor(() => getByTestId("goal-verdict-empty"));
  });

  it("deletes on confirm and navigates back to the board", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderDetail(goalFixture(), hook);
    await waitFor(() => getByTestId("goal-detail-delete"));
    fireEvent.click(getByTestId("goal-detail-delete"));
    await waitFor(() => expect(deletes.length).toBe(1));
    expect(deletes[0]).toContain("/api/folders/goals/g1");
    await waitFor(() => expect(history[history.length - 1]).toBe(goalsBoardUrl(cwd)));
  });

  it("does not delete when the confirm is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByTestId } = renderDetail(goalFixture());
    await waitFor(() => getByTestId("goal-detail-delete"));
    fireEvent.click(getByTestId("goal-detail-delete"));
    await new Promise((r) => setTimeout(r, 20));
    expect(deletes.length).toBe(0);
  });

  // Turns/spend fallback + display. No live snapshot (no goal_status events for
  // the driver) → the gauges must read the persisted record.
  // See change: fix-goal-detail-turns-and-spend.
  it("F1: no live snapshot → turns gauge converges to persisted 1/3, never —/3", async () => {
    const goal = goalFixture({ lastKnownTurnsUsed: 1, budget: { maxTurns: 3 } });
    const { getByTestId } = renderDetail(goal);
    await waitFor(() => getByTestId("goal-gauge-turns"));
    expect(getByTestId("goal-gauge-turns").querySelector(".font-mono")?.textContent).toBe("1/3");
  });

  it("F3: totalSpendUsd 0.29, no cap → '$0.29 · no cap', no fill element", async () => {
    const goal = goalFixture({ totalSpendUsd: 0.29 });
    const { getByTestId } = renderDetail(goal);
    await waitFor(() => getByTestId("goal-gauge-spend"));
    const gauge = getByTestId("goal-gauge-spend");
    expect(gauge.querySelector(".font-mono")?.textContent).toBe("$0.29 · no cap");
    // No cap → the emerald fill element is not rendered.
    expect(gauge.querySelector(".bg-emerald-400\\/70")).toBeNull();
  });

  it("F4: totalSpendUsd 0.29, cap 5 → '$0.29 / $5.00' + fill ≈6%", async () => {
    const goal = goalFixture({ totalSpendUsd: 0.29, budget: { maxSpendUsd: 5 } });
    const { getByTestId } = renderDetail(goal);
    await waitFor(() => getByTestId("goal-gauge-spend"));
    const gauge = getByTestId("goal-gauge-spend");
    expect(gauge.querySelector(".font-mono")?.textContent).toBe("$0.29 / $5.00");
    const fill = gauge.querySelector(".bg-emerald-400\\/70") as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe("6%");
  });
});
