/**
 * Seed-on-start coverage for the flows-plugin reducer.
 *
 * Regression guard: FlowState is seeded ONLY by the initial `flow_started`
 * event. Every other event returns null when no start was observed, so a
 * client that connects mid-flow (missing the start) renders nothing rather
 * than fabricating state from a progression event. Once seeded, progression
 * events advance status and drive agents to a terminal state.
 */

import type { DashboardEvent, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { reduceFlowEvent } from "../reducer.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}

function fold(events: Array<[string, Record<string, unknown>]>): FlowState | null {
  let s: FlowState | null = null;
  for (const [t, d] of events) s = reduceFlowEvent(s, ev(t, d));
  return s;
}

describe("flow reducer seed-on-start", () => {
  it("returns null for a progression event with no prior start", () => {
    expect(reduceFlowEvent(null, ev("flow_agent_complete", { agentName: "a", stepId: "s1" }))).toBeNull();
    expect(reduceFlowEvent(null, ev("flow_agent_started", { agentName: "a", stepId: "s1" }))).toBeNull();
  });

  it("seeds state on flow_started and advances through progression", () => {
    const state = fold([
      ["flow_started", {
        flowName: "invoice",
        task: "validate",
        steps: [{ id: "s1", stepType: "agent", agent: "extractor", blockedBy: [] }],
      }],
      ["flow_agent_started", { agentName: "extractor", stepId: "s1" }],
      ["flow_agent_complete", { agentName: "extractor", stepId: "s1", status: "complete" }],
    ]);
    expect(state).not.toBeNull();
    expect(state?.flowName).toBe("invoice");
    const agent = state?.agents.get("s1");
    expect(agent).toBeDefined();
    expect(["complete", "error", "blocked"]).toContain(agent?.status);
  });

  it("drops events that arrive before the start even if a later start appears with no prior state", () => {
    // A stray progression event against null stays null; the subsequent start
    // still seeds cleanly (no residue from the dropped event).
    const afterStray = reduceFlowEvent(null, ev("flow_agent_started", { agentName: "x", stepId: "s1" }));
    expect(afterStray).toBeNull();
    const seeded = reduceFlowEvent(afterStray, ev("flow_started", {
      flowName: "f",
      task: "t",
      steps: [{ id: "s1", stepType: "agent", agent: "x", blockedBy: [] }],
    }));
    expect(seeded?.status).toBe("running");
    expect(seeded?.agents.get("s1")?.status).toBe("pending");
  });
});
