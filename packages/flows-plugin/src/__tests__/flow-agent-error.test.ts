/**
 * flow_agent_error reducer case (change: replay-persisted-flow-runs).
 * pi-flows now emits flow:agent-error { agentName, stepId, text } for
 * step-level agent failures. The reducer appends { kind:"error", text } to
 * the agent's detailHistory. The error variant of FlowDetailEntry already
 * exists; this pins its producer case. Status stays owned by
 * flow_agent_complete — the error case does not change it.
 */
import { describe, it, expect } from "vitest";
import { reduceFlowEvent } from "../reducer.js";
import type { DashboardEvent, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}

function startedWithAgent(): FlowState {
  const s = reduceFlowEvent(
    null,
    ev("flow_started", { flowName: "f", task: "t", steps: [{ id: "research", agent: "researcher", blockedBy: [] }] }),
  );
  return reduceFlowEvent(s, ev("flow_agent_started", { agentName: "researcher", stepId: "research" }))!;
}

describe("reduceFlowEvent — flow_agent_error", () => {
  it("appends an { kind: 'error', text } entry to the agent detailHistory", () => {
    const s = startedWithAgent();
    const next = reduceFlowEvent(
      s,
      ev("flow_agent_error", { agentName: "researcher", stepId: "research", text: "tool quota exceeded" }),
    );
    const agent = next!.agents.get("research")!;
    const last = agent.detailHistory[agent.detailHistory.length - 1];
    expect(last).toEqual({ kind: "error", text: "tool quota exceeded" });
  });

  it("ignores events with empty text (no-op)", () => {
    const s = startedWithAgent();
    const before = s.agents.get("research")!.detailHistory.length;
    const next = reduceFlowEvent(s, ev("flow_agent_error", { agentName: "researcher", stepId: "research", text: "" }));
    expect(next!.agents.get("research")!.detailHistory.length).toBe(before);
  });

  it("does not change the agent status (status owned by flow_agent_complete)", () => {
    const s = startedWithAgent();
    const statusBefore = s.agents.get("research")!.status;
    const next = reduceFlowEvent(
      s,
      ev("flow_agent_error", { agentName: "researcher", stepId: "research", text: "boom" }),
    );
    expect(next!.agents.get("research")!.status).toBe(statusBefore);
  });

  it("locates the agent by agentName when stepId is absent", () => {
    const s = startedWithAgent();
    const next = reduceFlowEvent(s, ev("flow_agent_error", { agentName: "researcher", text: "boom" }));
    const agent = next!.agents.get("research")!;
    expect(agent.detailHistory.some((e) => e.kind === "error" && e.text === "boom")).toBe(true);
  });
});
