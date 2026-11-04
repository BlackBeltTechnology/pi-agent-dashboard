/**
 * pi-flows 0.10 fan-out: item-indexed events key `<stepId>[<i>]` cards under
 * `groups[stepId]`; the pre-listed step card is the group parent, its status
 * derived by the D6 precedence. See change: update-flows-plugin
 * (test-plan E18–E22).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { deriveGroupParent } from "../flow-reducer.js";
import { reduceFlowEvent } from "../reducer.js";
import type { FlowAgentState, FlowState } from "../types.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}
function fold(s: FlowState | null, events: Array<[string, Record<string, unknown>]>): FlowState {
  for (const [t, d] of events) s = reduceFlowEvent(s, ev(t, d));
  return s as FlowState;
}
const START: [string, Record<string, unknown>] = [
  "flow_started",
  { flowName: "f", task: "t", steps: [{ id: "review", stepType: "agent", agent: "reviewer", blockedBy: [] }] },
];
const started = (i: number): [string, Record<string, unknown>] => [
  "flow_agent_started",
  { agentName: "reviewer", stepId: "review", itemIndex: i, itemCount: 3 },
];
const done = (i: number, ok: boolean, outcome?: "soft" | "hard"): [string, Record<string, unknown>] => [
  "flow_agent_complete",
  {
    agentName: "reviewer",
    stepId: "review",
    itemIndex: i,
    result: { success: ok, ...(outcome ? { outcome } : {}) },
  },
];

describe("fan-out items render as a group (E18)", () => {
  it("three item starts produce three item cards under the parent; no rerun", () => {
    const s = fold(null, [START, started(0), started(1), started(2)]);
    expect(s.groups?.review.map((i) => i.itemKey)).toEqual(["review[0]", "review[1]", "review[2]"]);
    const parent = s.agents.get("review")!;
    expect(parent.stepId).toBe("review");
    expect(parent.status).toBe("running");
    expect([...s.agents.keys()]).toEqual(["review"]);
    expect(parent.runCount ?? 1).toBe(1);
    for (const item of s.groups!.review) expect(item.runCount ?? 1).toBe(1);
  });
});

describe("item-indexed events target the item (E19)", () => {
  const base = () => fold(null, [START, started(0), started(1)]);
  it("(a) tool / text / thinking with itemIndex 1 change only review[1]", () => {
    const s0 = base();
    const s = fold(s0, [
      ["flow_tool_call", { agentName: "reviewer", stepId: "review", itemIndex: 1, toolName: "read", input: { path: "a.ts" } }],
      ["flow_assistant_text", { agentName: "reviewer", stepId: "review", itemIndex: 1, text: "hi" }],
      ["flow_thinking_text", { agentName: "reviewer", stepId: "review", itemIndex: 1, text: "hmm" }],
    ]);
    expect(s.groups!.review[1].detailHistory.map((d) => d.kind)).toEqual(["tool", "text", "thinking"]);
    expect(s.groups!.review[1].recentTools).toEqual([{ toolName: "read", inputPreview: "a.ts" }]);
    expect(s.groups!.review[0]).toEqual(s0.groups!.review[0]);
    expect(s.agents.get("review")).toEqual(s0.agents.get("review"));
  });
  it("(b) tool result and completion with itemIndex 0 change only review[0]", () => {
    const s0 = fold(base(), [
      ["flow_tool_call", { agentName: "reviewer", stepId: "review", itemIndex: 0, toolName: "bash", input: {} }],
    ]);
    const s1 = fold(s0, [
      ["flow_tool_result", { agentName: "reviewer", stepId: "review", itemIndex: 0, output: "ok" }],
    ]);
    expect(s1.groups!.review[0].detailHistory[0]).toMatchObject({ kind: "tool", output: "ok" });
    expect(s1.groups!.review[1]).toEqual(s0.groups!.review[1]);
    const s2 = fold(s1, [done(0, true)]);
    expect(s2.groups!.review[0].status).toBe("complete");
    expect(s2.groups!.review[1]).toEqual(s1.groups!.review[1]);
  });
  it("(c) text without itemIndex changes only the parent", () => {
    const s0 = base();
    const s = fold(s0, [["flow_assistant_text", { agentName: "reviewer", stepId: "review", text: "group" }]]);
    expect(s.agents.get("review")!.detailHistory).toEqual([{ kind: "text", text: "group" }]);
    expect(s.groups).toEqual(s0.groups);
  });
});

describe("item error appends without a status change (E20)", () => {
  it("appends to the item, then to the parent without itemIndex", () => {
    const s0 = fold(null, [START, started(0), started(1), started(2)]);
    const n = s0.groups!.review[2].detailHistory.length;
    const s1 = fold(s0, [["flow_agent_error", { agentName: "reviewer", stepId: "review", itemIndex: 2, text: "boom" }]]);
    expect(s1.groups!.review[2].detailHistory).toHaveLength(n + 1);
    expect(s1.groups!.review[2].status).toBe("running");
    const s2 = fold(s1, [["flow_agent_error", { agentName: "reviewer", stepId: "review", text: "group boom" }]]);
    expect(s2.agents.get("review")!.detailHistory.at(-1)).toEqual({ kind: "error", text: "group boom" });
  });
});

const item = (status: FlowAgentState["status"], outcome?: "soft" | "hard"): FlowAgentState => ({
  agentName: "r",
  stepId: "review",
  status,
  ...(outcome ? { outcome } : {}),
  blockedBy: [],
  recentTools: [],
  detailHistory: [],
});

describe("group parent status precedence (E21)", () => {
  it.each([
    ["running + error-soft", [item("running"), item("error", "soft")], "running", undefined, undefined],
    ["started-pending + complete", [item("pending"), item("complete")], "running", undefined, undefined],
    ["error-soft + complete", [item("error", "soft"), item("complete")], "error", "soft", { ok: 1, failed: 1 }],
    ["error-soft + error-hard", [item("error", "soft"), item("error", "hard")], "error", "hard", undefined],
    ["blocked + complete", [item("blocked"), item("complete")], "blocked", undefined, undefined],
    ["blocked + error-soft", [item("blocked"), item("error", "soft")], "error", "soft", undefined],
    ["skipped + skipped", [item("skipped"), item("skipped")], "skipped", undefined, undefined],
    ["zero items", [], "skipped", undefined, { ok: 0, failed: 0 }],
    ["complete + complete", [item("complete"), item("complete")], "complete", undefined, { ok: 2, failed: 0 }],
  ] as const)("%s", (_n, items, status, outcome, rollup) => {
    const d = deriveGroupParent(items as FlowAgentState[]);
    expect(d.status).toBe(status);
    if (outcome) expect(d.outcome).toBe(outcome);
    if (rollup) expect(d.rollup).toEqual(rollup);
  });

  it("through the reducer: all items complete → parent complete, rollup 2 ok", () => {
    const s = fold(null, [START, started(0), started(1), done(0, true), done(1, true)]);
    expect(s.agents.get("review")).toMatchObject({ status: "complete", rollup: { ok: 2, failed: 0 } });
  });
});

describe("failure is not hidden by order (E22)", () => {
  it.each([
    ["A: fail then succeed", [done(0, false, "soft"), done(1, true)]],
    ["B: succeed then fail", [done(1, true), done(0, false, "soft")]],
  ] as const)("%s", (_n, completes) => {
    const s = fold(null, [START, started(0), started(1), ...completes]);
    expect(s.agents.get("review")).toMatchObject({ status: "error", outcome: "soft", rollup: { ok: 1, failed: 1 } });
  });
});
