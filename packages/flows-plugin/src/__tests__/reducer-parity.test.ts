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
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowState } from "../types.js";

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

/**
 * X10: a pi-flows 0.9-shape producer (no itemIndex, no flow_decision, no
 * skipped) reduces exactly as before: one card per step, no groups, and the
 * final state carries no 0.10-only field. See change: update-flows-plugin.
 */
describe("pre-0.10 producer parity (X10)", () => {
  it("a 2-step lifecycle yields one card per step and no groups / decisions", () => {
    const events: Array<[string, Record<string, unknown>]> = [
      ["flow_started", { flowName: "f", task: "t", steps: [
        { id: "a", stepType: "agent", agent: "alpha", blockedBy: [] },
        { id: "b", stepType: "agent", agent: "beta", blockedBy: ["a"] },
      ] }],
      ["flow_agent_started", { agentName: "alpha", stepId: "a" }],
      ["flow_tool_call", { agentName: "alpha", stepId: "a", toolName: "read", input: { path: "x.ts" } }],
      ["flow_agent_complete", { agentName: "alpha", stepId: "a", result: { success: true, summary: "ok" } }],
      ["flow_agent_started", { agentName: "beta", stepId: "b" }],
      ["flow_agent_complete", { agentName: "beta", stepId: "b", result: { success: false } }],
      ["flow_complete", { status: "error" }],
    ];
    let s: FlowState | null = null;
    for (const [t, d] of events) s = reduceFlowEvent(s, ev(t, d));
    expect([...s!.agents.keys()]).toEqual(["a", "b"]);
    expect(s!.groups).toBeUndefined();
    expect(s!.decisions).toBeUndefined();
    expect(s!.skippedSteps).toBeUndefined();
    expect(s!.agents.get("a")).toMatchObject({ status: "complete", outcome: "success", summary: "ok" });
    expect(s!.agents.get("a")!.recentTools).toEqual([{ toolName: "read", inputPreview: "x.ts" }]);
    expect(s!.agents.get("b")).toMatchObject({ status: "error", outcome: "soft" });
    for (const a of s!.agents.values()) {
      expect(a.itemKey).toBeUndefined();
      expect(a.rollup).toBeUndefined();
      expect(a.decision).toBeUndefined();
    }
    expect(s!.status).toBe("error");
  });
});
