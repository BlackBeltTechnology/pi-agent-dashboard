/**
 * Node-kind / code-node reducer coverage for the rework-flows-plugin-for-new-pi-flows
 * change. Pins: nodeKind decided at started, code target, typed outputs + chosen
 * branch from complete, soft/hard outcome, interrupted downgrade, pre-listed code
 * cards, and replay identity (same fold for live + persisted events).
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowState } from "../types.js";
import { describe, expect, it } from "vitest";
import { reduceFlowEvent } from "../reducer.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}

/** Drive a sequence of events through the fold, starting from null. */
function fold(events: Array<[string, Record<string, unknown>]>): FlowState | null {
  let s: FlowState | null = null;
  for (const [t, d] of events) s = reduceFlowEvent(s, ev(t, d));
  return s;
}

const startedWithCode: Array<[string, Record<string, unknown>]> = [
  ["flow_started", {
    flowName: "invoice", task: "validate",
    steps: [
      { id: "extract", stepType: "agent", agent: "extractor", blockedBy: [] },
      { id: "validate-nav", stepType: "code", blockedBy: ["extract"] },
      { id: "approve", stepType: "code-decision", blockedBy: ["validate-nav"] },
    ],
  }],
];

describe("node-kind reducer", () => {
  it("pre-lists code and code-decision steps as pending cards (task 2.6)", () => {
    const s = fold(startedWithCode)!;
    expect(s.agents.get("validate-nav")?.nodeKind).toBe("code");
    expect(s.agents.get("validate-nav")?.status).toBe("pending");
    expect(s.agents.get("approve")?.nodeKind).toBe("code-decision");
    expect(s.agents.get("extract")?.nodeKind).toBe("agent");
  });

  it("decides nodeKind + code target at started; never changes at complete", () => {
    const s = fold([
      ...startedWithCode,
      ["flow_agent_started", { agentName: "validate-nav", stepId: "validate-nav", nodeKind: "code", target: "handlers/validate-nav.ts" }],
      ["flow_assistant_text", { agentName: "validate-nav", stepId: "validate-nav", text: "checking record against NAV" }],
      ["flow_agent_complete", { agentName: "validate-nav", stepId: "validate-nav", result: { success: true, summary: "validated against NAV", typedOutputs: { valid: "true", nav_record: "INV-2231" }, outcome: "success" } }],
    ])!;
    const code = s.agents.get("validate-nav")!;
    expect(code.nodeKind).toBe("code");
    expect(code.codeTarget).toBe("handlers/validate-nav.ts");
    expect(code.status).toBe("complete");
    expect(code.summary).toBe("validated against NAV");
    expect(code.typedOutputs).toEqual({ valid: "true", nav_record: "INV-2231" });
    // logger output rode the assistant-text channel → detailHistory text entry (logs by card kind)
    expect(code.detailHistory).toContainEqual({ kind: "text", text: "checking record against NAV" });
  });

  it("exposes the chosen branch from typedOutputs for code-decision", () => {
    const s = fold([
      ...startedWithCode,
      ["flow_agent_started", { agentName: "approve", stepId: "approve", nodeKind: "code-decision" }],
      ["flow_agent_complete", { agentName: "approve", stepId: "approve", result: { success: true, typedOutputs: { branch: "rework", score: "72" }, outcome: "success" } }],
      ["flow_loop_iteration", { loopTarget: "approve", iteration: 2, maxIterations: 3 }],
    ])!;
    const dec = s.agents.get("approve")!;
    expect(dec.branch).toBe("rework");
    expect(dec.loopIteration).toBe(2);
    expect(dec.loopMax).toBe(3);
  });

  it("records soft outcome on a routed failure", () => {
    const s = fold([
      ...startedWithCode,
      ["flow_agent_started", { agentName: "validate-nav", stepId: "validate-nav", nodeKind: "code" }],
      ["flow_agent_complete", { agentName: "validate-nav", stepId: "validate-nav", result: { success: false, outcome: "soft" } }],
    ])!;
    expect(s.agents.get("validate-nav")?.outcome).toBe("soft");
    expect(s.agents.get("validate-nav")?.status).toBe("error");
  });

  it("downgrades in-flight cards to error on a non-success terminal (task 3.6)", () => {
    const s = fold([
      ...startedWithCode,
      ["flow_agent_started", { agentName: "validate-nav", stepId: "validate-nav", nodeKind: "code" }],
      ["flow_complete", { status: "interrupted" }],
    ])!;
    expect(s.status).toBe("interrupted");
    // started-but-never-completed code card must not spin forever
    expect(s.agents.get("validate-nav")?.status).toBe("error");
    expect(s.agents.get("validate-nav")?.outcome).toBe("hard");
    // pending sibling also resolved
    expect(s.agents.get("approve")?.status).toBe("error");
  });

  it("falls back to an agent card when nodeKind is absent (pre-contract / skew)", () => {
    const s = fold([
      ["flow_started", { flowName: "f", task: "t", steps: [{ id: "a", stepType: "agent", agent: "a", blockedBy: [] }] }],
      ["flow_agent_started", { agentName: "a", stepId: "a" }], // no nodeKind
    ])!;
    expect(s.agents.get("a")?.nodeKind).toBe("agent");
  });

  it("lands on_complete / on_error onto dagSteps; absent fields stay undefined", () => {
    // See change: fix-flow-ui-graph-zoom-summary — routing fields drive live route edges.
    const s = fold([
      ["flow_started", {
        flowName: "invoice", task: "t",
        steps: [
          { id: "load-state", stepType: "code", blockedBy: [], onComplete: "resume-gate", onError: "hold" },
          { id: "resume-gate", stepType: "code-decision", blockedBy: [], branches: { new: "intake" } },
        ],
      }],
    ])!;
    const loadState = s.dagSteps?.find(d => d.id === "load-state");
    expect(loadState?.onComplete).toBe("resume-gate");
    expect(loadState?.onError).toBe("hold");
    const gate = s.dagSteps?.find(d => d.id === "resume-gate");
    expect(gate?.onComplete).toBeUndefined();
    expect(gate?.onError).toBeUndefined();
  });

  it("replays identically: same fold over persisted events rebuilds the same card", () => {
    const seq: Array<[string, Record<string, unknown>]> = [
      ...startedWithCode,
      ["flow_agent_started", { agentName: "approve", stepId: "approve", nodeKind: "code-decision" }],
      ["flow_agent_complete", { agentName: "approve", stepId: "approve", result: { success: true, typedOutputs: { branch: "rework" }, outcome: "success" } }],
      ["flow_loop_iteration", { loopTarget: "approve", iteration: 2, maxIterations: 3 }],
    ];
    const live = fold(seq)!;
    const replay = fold(seq)!; // replay re-forwards the identical records
    expect(replay.agents.get("approve")).toEqual(live.agents.get("approve"));
  });
});
