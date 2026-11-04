/**
 * pi-flows 0.10 `flow_decision`: chosen routes stored, unchosen targets of THIS
 * decision `skipped`, a route error marks nothing, `flow_complete` never
 * downgrades `skipped`. See change: update-flows-plugin (test-plan E23–E27).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { reduceFlowEvent } from "../reducer.js";
import type { FlowState } from "../types.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}
function fold(s: FlowState | null, events: Array<[string, Record<string, unknown>]>): FlowState {
  for (const [t, d] of events) s = reduceFlowEvent(s, ev(t, d));
  return s as FlowState;
}
const START: [string, Record<string, unknown>] = [
  "flow_started",
  {
    flowName: "f",
    task: "t",
    steps: [
      { id: "triage", stepType: "agent-decision", agent: "triager", blockedBy: [], branches: { bug: "fix", docs: "doc" } },
      { id: "fix", stepType: "agent", agent: "fixer", blockedBy: [] },
      { id: "doc", stepType: "agent", agent: "writer", blockedBy: [] },
      { id: "report", stepType: "agent", agent: "reporter", blockedBy: [] },
    ],
  },
];
const complete = (stepId: string, agentName: string): [string, Record<string, unknown>] => [
  "flow_agent_complete",
  { agentName, stepId, result: { success: true } },
];
const status = (s: FlowState, id: string) => s.agents.get(id)?.status;

describe("flow_decision (E23)", () => {
  it("stores labels / routes on the decision card; unchosen target skipped", () => {
    const s = fold(null, [START, ["flow_decision", { stepId: "triage", labels: ["bug"], routes: [{ branch: "bug" }] }]]);
    expect(s.agents.get("triage")!.decision).toMatchObject({ labels: ["bug"], routes: [{ branch: "bug" }], notTaken: ["doc"] });
    expect(status(s, "doc")).toBe("skipped");
    expect(status(s, "fix")).toBe("pending");
  });
});

describe("loop re-entry scope (E24)", () => {
  it("overwrites only this decision's stale targets", () => {
    const s0 = fold(null, [START, complete("doc", "writer"), complete("report", "reporter")]);
    expect(status(s0, "doc")).toBe("complete");
    const s = fold(s0, [["flow_decision", { stepId: "triage", labels: ["bug"], routes: [{ branch: "bug" }] }]]);
    expect(status(s, "doc")).toBe("skipped");
    expect(status(s, "report")).toBe("complete");
  });
});

describe("route error marks nothing (E25)", () => {
  it("keeps targets pending and stores the error", () => {
    const err = "for_each must resolve to an array";
    const s = fold(null, [START, ["flow_decision", { stepId: "triage", routeError: err }]]);
    expect(status(s, "fix")).toBe("pending");
    expect(status(s, "doc")).toBe("pending");
    expect(s.agents.get("triage")!.decision?.routeError).toBe(err);
  });
});

describe("empty multi-route choice (E26)", () => {
  it("skips every target", () => {
    const s = fold(null, [START, ["flow_decision", { stepId: "triage", labels: [], routes: [] }]]);
    expect(status(s, "fix")).toBe("skipped");
    expect(status(s, "doc")).toBe("skipped");
  });
});

describe("skipped never downgraded (E27)", () => {
  it("flow_complete error keeps skipped; others as before", () => {
    const s0 = fold(null, [
      START,
      ["flow_decision", { stepId: "triage", labels: ["bug"], routes: [{ branch: "bug" }] }],
      ["flow_agent_started", { agentName: "fixer", stepId: "fix" }],
    ]);
    const s = fold(s0, [["flow_complete", { status: "error" }]]);
    expect(status(s, "doc")).toBe("skipped");
    // running / pending → error/hard (the pre-change rule).
    expect(s.agents.get("fix")).toMatchObject({ status: "error", outcome: "hard" });
    expect(s.agents.get("report")).toMatchObject({ status: "error", outcome: "hard" });
  });
});

describe("fan-out route with item count", () => {
  it("a route itemCount 0 reads skipped; a positive count sizes the parent", () => {
    const zero = fold(null, [START, ["flow_decision", { stepId: "triage", labels: ["bug"], routes: [{ branch: "bug", itemCount: 0 }] }]]);
    expect(status(zero, "fix")).toBe("skipped");
    const three = fold(null, [START, ["flow_decision", { stepId: "triage", labels: ["bug"], routes: [{ branch: "bug", itemCount: 3 }] }]]);
    expect(three.agents.get("fix")).toMatchObject({ status: "pending", itemCount: 3 });
  });
});
