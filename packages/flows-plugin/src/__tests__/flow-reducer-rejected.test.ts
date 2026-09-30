/**
 * A `flow_complete` with `status: "rejected"` is pi-flows refusing a start
 * (unknown flow, gate, another run in progress). It is emitted without any
 * `flow_started`, so it never refers to the run held in `flowState` and MUST
 * leave that state untouched. See change: attach-flow-before-run (D10).
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

const runningResearch: Array<[string, Record<string, unknown>]> = [
  ["flow_started", {
    flowName: "research",
    task: "t",
    steps: [
      { id: "a", stepType: "agent", agent: "alpha", blockedBy: [] },
      { id: "b", stepType: "agent", agent: "beta", blockedBy: [] },
    ],
  }],
  ["flow_agent_started", { agentName: "alpha", stepId: "a" }],
  ["flow_agent_started", { agentName: "beta", stepId: "b" }],
];

describe("flow reducer: rejected start (D10)", () => {
  it("leaves a running flow running with card statuses unchanged", () => {
    const before = fold(runningResearch)!;
    expect(before.agents.get("a")?.status).toBe("running");
    expect(before.agents.get("b")?.status).toBe("running");
    const after = reduceFlowEvent(before, ev("flow_complete", {
      status: "rejected",
      flowName: "research",
      reason: "A flow is already running",
      stepCount: 0,
    }));
    expect(after).toBe(before);
    expect(after?.status).toBe("running");
    expect(after?.agents.get("a")?.status).toBe("running");
    expect(after?.agents.get("b")?.status).toBe("running");
    expect(after?.flowResult).toBeUndefined();
  });

  it("returns null when there is no flow state", () => {
    expect(reduceFlowEvent(null, ev("flow_complete", { status: "rejected", flowName: "x" }))).toBeNull();
  });

  it("still applies a success completion (regression)", () => {
    const s = fold([...runningResearch, ["flow_complete", { status: "success", flowName: "research" }]]);
    expect(s?.status).toBe("success");
  });
});
