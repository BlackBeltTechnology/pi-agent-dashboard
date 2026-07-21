/**
 * empty_actionable_surface → non-error notice on SessionState.
 *
 * The bridge guard forwards `empty_actionable_surface` when a turn returned
 * only reasoning. The reducer sets `state.notice` (distinct from `lastError`)
 * and clears it on the next `agent_start`.
 *
 * See change: fix-gemini-subagent-silent-tool-schema-failure.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

const surface = (message?: string): DashboardEvent => ({
  eventType: "empty_actionable_surface",
  timestamp: 100,
  data: message ? { message } : {},
});

describe("empty_actionable_surface reducer arm", () => {
  it("sets a non-error notice, not lastError", () => {
    const s = applyEvents([surface("model returned only reasoning, no answer")]);
    expect(s.notice).toEqual({ message: "model returned only reasoning, no answer", timestamp: 100 });
    expect(s.lastError).toBeUndefined();
  });

  it("falls back to a default message when none is provided", () => {
    const s = applyEvents([surface()]);
    expect(s.notice?.message).toBe("model returned only reasoning, no answer");
  });

  it("clears the notice on the next agent_start", () => {
    const s = applyEvents([
      surface("only reasoning"),
      { eventType: "agent_start", timestamp: 200, data: {} },
    ]);
    expect(s.notice).toBeUndefined();
  });
});
