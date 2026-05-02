/**
 * Parity test pinning the moved reducer's behavior post-extraction.
 *
 * The reducer logic was moved from `packages/client/src/lib/flow-reducer.ts`
 * to `packages/flows-plugin/src/flow-reducer.ts` by the OpenSpec change
 * `extract-flows-as-plugin`. The contract — `(state, event) → newState` —
 * is unchanged. This test dispatches a representative `flow_started →
 * flow_agent_started → flow_complete` sequence and snapshots the resulting
 * `FlowState` so a future contract drift fails loudly here.
 */
import { describe, it, expect } from "vitest";
import { isFlowEvent, reduceFlowEvent } from "../reducer.js";
import type { DashboardEvent, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return {
    seq: 1,
    timestamp: 0,
    sessionId: "s1",
    eventType: type,
    data,
  } as unknown as DashboardEvent;
}

describe("flow-reducer parity (post-extract-flows-as-plugin)", () => {
  it("recognizes every flow_* event type via isFlowEvent", () => {
    expect(isFlowEvent("flow_started")).toBe(true);
    expect(isFlowEvent("flow_agent_started")).toBe(true);
    expect(isFlowEvent("flow_agent_complete")).toBe(true);
    expect(isFlowEvent("flow_tool_call")).toBe(true);
    expect(isFlowEvent("flow_tool_result")).toBe(true);
    expect(isFlowEvent("flow_assistant_text")).toBe(true);
    expect(isFlowEvent("flow_thinking_text")).toBe(true);
    expect(isFlowEvent("flow_loop_iteration")).toBe(true);
    expect(isFlowEvent("flow_complete")).toBe(true);
    expect(isFlowEvent("flow_summary_dismissed")).toBe(true);
    // negative
    expect(isFlowEvent("message_start")).toBe(false);
    expect(isFlowEvent("turn_end")).toBe(false);
    expect(isFlowEvent("architect_started")).toBe(false);
  });

  it("reduces flow_started → creates FlowState with pending agents", () => {
    const state: FlowState | null = null;
    const next = reduceFlowEvent(
      state,
      ev("flow_started", {
        flowName: "research",
        task: "Find bugs",
        steps: [
          { id: "r", agent: "researcher", blockedBy: [] },
          { id: "d", agent: "developer", blockedBy: ["r"] },
        ],
      }),
    );
    expect(next).not.toBeNull();
    expect(next!.flowName).toBe("research");
    expect(next!.task).toBe("Find bugs");
    expect(next!.status).toBe("running");
    expect(next!.agents.size).toBe(2);
    const r = next!.agents.get("r")!;
    const d = next!.agents.get("d")!;
    expect(r.agentName).toBe("researcher");
    expect(r.status).toBe("pending");
    expect(d.blockedBy).toEqual(["r"]);
  });

  it("reduces flow_agent_started → agent transitions to running", () => {
    let s = reduceFlowEvent(
      null,
      ev("flow_started", {
        flowName: "f",
        task: "t",
        steps: [{ id: "r", agent: "researcher", blockedBy: [] }],
      }),
    );
    s = reduceFlowEvent(
      s,
      ev("flow_agent_started", {
        agentName: "researcher",
        config: { model: "@research", card: { label: "Research" } },
      }),
    );
    const r = s!.agents.get("r")!;
    expect(r.status).toBe("running");
    expect(r.label).toBe("Research");
    expect(r.model).toBe("@research");
  });

  it("reduces flow_complete → status updates and flowResult stored", () => {
    let s = reduceFlowEvent(
      null,
      ev("flow_started", { flowName: "f", task: "t", steps: [{ id: "r", agent: "r", blockedBy: [] }] }),
    );
    s = reduceFlowEvent(
      s,
      ev("flow_complete", {
        status: "success",
        flowName: "f",
        results: { totalAgents: 1, successCount: 1 },
      }),
    );
    expect(s!.status).toBe("success");
    expect(s!.flowResult).toBeDefined();
  });
});
