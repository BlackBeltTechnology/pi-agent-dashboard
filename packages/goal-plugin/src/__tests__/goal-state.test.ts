/**
 * Unit tests for the goal-plugin pure logic: extension-event → snapshot
 * mapping (bridge side) and event-store → snapshot folding (client side).
 *
 * See change: add-goal-continuation-plugin.
 */

import type { DashboardEvent, GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { deriveSnapshot, fmtUsd, gaugePct, resolveGoalTurns } from "../client/goal-state.js";
import type { GoalStatusSnapshot } from "../shared/goal-types.js";
import {
  detailsToSnapshot,
  GOAL_STATUS_EVENT_TYPE,
  type GoalHermesEventDetails,
} from "../shared/goal-types.js";

function details(over: Partial<GoalHermesEventDetails>): GoalHermesEventDetails {
  return {
    eventType: "goal-set",
    goal: "Ship it",
    status: "active",
    turnsUsed: 0,
    maxTurns: 20,
    lastVerdict: null,
    lastReason: null,
    pausedReason: null,
    ...over,
  };
}

function statusEvent(snapshot: unknown): DashboardEvent {
  return { eventType: GOAL_STATUS_EVENT_TYPE, timestamp: Date.now(), data: snapshot as Record<string, unknown> };
}

describe("detailsToSnapshot: eventType → status mapping", () => {
  it("maps goal-set / goal-continuing / goal-resumed → active", () => {
    for (const t of ["goal-set", "goal-continuing", "goal-resumed"] as const) {
      expect(detailsToSnapshot(details({ eventType: t })).status).toBe("active");
    }
  });

  it("maps goal-achieved → done", () => {
    expect(detailsToSnapshot(details({ eventType: "goal-achieved" })).status).toBe("done");
  });

  it("maps goal-paused → paused and surfaces pausedReason as lastReason", () => {
    const s = detailsToSnapshot(details({ eventType: "goal-paused", pausedReason: "budget exhausted" }));
    expect(s.status).toBe("paused");
    expect(s.lastReason).toBe("budget exhausted");
  });

  it("maps goal-cleared → cleared", () => {
    expect(detailsToSnapshot(details({ eventType: "goal-cleared" })).status).toBe("cleared");
  });

  it("carries goal text + turn counters + verdict", () => {
    const s = detailsToSnapshot(details({ eventType: "goal-continuing", turnsUsed: 4, lastVerdict: "continue" }));
    expect(s).toMatchObject({ goal: "Ship it", turnsUsed: 4, maxTurns: 20, lastVerdict: "continue" });
  });
});

describe("deriveSnapshot: event-store folding (last write wins)", () => {
  it("returns null when no goal_status events exist", () => {
    expect(deriveSnapshot([])).toBeNull();
    expect(deriveSnapshot([{ eventType: "message_end", timestamp: 1, data: {} }])).toBeNull();
  });

  it("returns the latest snapshot across multiple events", () => {
    const events = [
      statusEvent(detailsToSnapshot(details({ eventType: "goal-set" }))),
      statusEvent(detailsToSnapshot(details({ eventType: "goal-continuing", turnsUsed: 4 }))),
    ];
    expect(deriveSnapshot(events)).toMatchObject({ status: "active", turnsUsed: 4 });
  });

  it("hides (null) once the latest snapshot is cleared", () => {
    const events = [
      statusEvent(detailsToSnapshot(details({ eventType: "goal-continuing", turnsUsed: 4 }))),
      statusEvent(detailsToSnapshot(details({ eventType: "goal-cleared" }))),
    ];
    expect(deriveSnapshot(events)).toBeNull();
  });

  it("surfaces a paused snapshot with its reason", () => {
    const events = [statusEvent(detailsToSnapshot(details({ eventType: "goal-paused", pausedReason: "reload" })))];
    expect(deriveSnapshot(events)).toMatchObject({ status: "paused", lastReason: "reload" });
  });

  it("ignores malformed goal_status data", () => {
    expect(deriveSnapshot([statusEvent({ notAStatus: true })])).toBeNull();
  });
});

// See change: fix-goal-detail-turns-and-spend.
function snap(over: Partial<Pick<GoalStatusSnapshot, "turnsUsed" | "maxTurns">>): Pick<GoalStatusSnapshot, "turnsUsed" | "maxTurns"> {
  return { turnsUsed: 0, maxTurns: 0, ...over };
}
function rec(over: Partial<Pick<GoalRecord, "lastKnownTurnsUsed" | "budget">>): Pick<GoalRecord, "lastKnownTurnsUsed" | "budget"> {
  return { ...over };
}

describe("resolveGoalTurns: live snapshot wins, else persisted fallback", () => {
  it("E1: snap=null + lastKnownTurnsUsed:1, budget.maxTurns:3 → 1/3", () => {
    expect(resolveGoalTurns(null, rec({ lastKnownTurnsUsed: 1, budget: { maxTurns: 3 } }))).toEqual({ turnsUsed: 1, maxTurns: 3 });
  });

  it("E2: snap={turnsUsed:2,maxTurns:5} + lastKnownTurnsUsed:1, budget.maxTurns unset → live wins 2/5", () => {
    expect(resolveGoalTurns(snap({ turnsUsed: 2, maxTurns: 5 }), rec({ lastKnownTurnsUsed: 1 }))).toEqual({ turnsUsed: 2, maxTurns: 5 });
  });

  it("E3: snap=null + lastKnownTurnsUsed undefined, budget.maxTurns:3 → —/3 (numerator undefined)", () => {
    expect(resolveGoalTurns(null, rec({ budget: { maxTurns: 3 } }))).toEqual({ turnsUsed: undefined, maxTurns: 3 });
  });

  it("E4: snap=null + lastKnownTurnsUsed:0, budget.maxTurns:3 → 0/3 (?? keeps 0)", () => {
    expect(resolveGoalTurns(null, rec({ lastKnownTurnsUsed: 0, budget: { maxTurns: 3 } }))).toEqual({ turnsUsed: 0, maxTurns: 3 });
  });
});

describe("fmtUsd + gaugePct: spend formatting (F6)", () => {
  it("F6: absent/0 → $0.00", () => {
    expect(fmtUsd(undefined)).toBe("$0.00");
    expect(fmtUsd(0)).toBe("$0.00");
  });

  it("F6: fmtUsd(0.29) → $0.29, fmtUsd(5) → $5.00", () => {
    expect(fmtUsd(0.29)).toBe("$0.29");
    expect(fmtUsd(5)).toBe("$5.00");
  });

  it("F6: gaugePct(0.29, 5) ≈ 6", () => {
    expect(gaugePct(0.29, 5)).toBe(6);
  });
});
