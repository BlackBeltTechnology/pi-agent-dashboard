/**
 * Unit tests for the goal-plugin pure logic: extension-event → snapshot
 * mapping (bridge side) and event-store → snapshot folding (client side).
 *
 * See change: add-goal-continuation-plugin.
 */
import { describe, it, expect } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  detailsToSnapshot,
  GOAL_STATUS_EVENT_TYPE,
  type GoalHermesEventDetails,
} from "../shared/goal-types.js";
import { deriveSnapshot } from "../client/goal-state.js";

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
