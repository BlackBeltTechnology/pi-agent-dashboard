import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { computeLayout, FlowGraph, type FlowGraphStep, flowStateToGraphSteps, mapStepType } from "../client/FlowGraph.js";
import { deriveFlowEdges, type FlowEdgeStep } from "../client/flow-edges.js";
import type { FlowAgentState, FlowState } from "../types.js";
import { CC10, IN_SEGMENT_ON_ERROR, NTI, SD4, UPD } from "./engine-order-fixtures.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.zoomControls, ((() => null) as never));

afterEach(() => cleanup());

describe("FlowGraph render: on_complete label suppression", () => {
  it("renders branch labels but never the on_complete label", () => {
    // See change: fix-flow-ui-graph-zoom-summary — on_complete is the happy-path
    // default and renders as a plain arrow; branch labels stay visible.
    const steps: FlowGraphStep[] = [
      { id: "load", label: "load", status: "complete", blockedBy: [], type: "code", onComplete: "gate" },
      { id: "gate", label: "gate", status: "complete", blockedBy: [], type: "code-decision", branches: { go: "done" } },
      { id: "done", label: "done", status: "pending", blockedBy: [] },
    ];
    const { container } = render(
      createElement(UiPrimitiveProvider, {
        value: registry,
        children: createElement(FlowGraph, { steps }),
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("go"); // branch label rendered
    expect(text).not.toContain("on_complete"); // route happy-path label suppressed
  });
});

describe("mapStepType (canonical node set)", () => {
  it("maps the new code node kinds", () => {
    expect(mapStepType("code")).toBe("code");
    expect(mapStepType("code-decision")).toBe("code-decision");
  });
  it("maps fork + agent-decision to fork shape", () => {
    expect(mapStepType("fork")).toBe("fork");
    expect(mapStepType("agent-decision")).toBe("fork");
  });
  it("agent and removed legacy types (incl. flow-ref) map to default (undefined)", () => {
    expect(mapStepType("agent")).toBeUndefined();
    expect(mapStepType("conditional")).toBeUndefined();
    expect(mapStepType("agent-loop-decision")).toBeUndefined();
    expect(mapStepType("flow-ref")).toBeUndefined();
  });
});

describe("computeLayout", () => {
  it("lays out a linear flow A→B→C left-to-right", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "step-a", status: "complete", blockedBy: [] },
      { id: "b", label: "step-b", status: "running", blockedBy: ["a"] },
      { id: "c", label: "step-c", status: "pending", blockedBy: ["b"] },
    ];

    const result = computeLayout(steps);

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);

    // Nodes should be left-to-right: a.x < b.x < c.x
    const nodeA = result.nodes.find(n => n.id === "a")!;
    const nodeB = result.nodes.find(n => n.id === "b")!;
    const nodeC = result.nodes.find(n => n.id === "c")!;
    expect(nodeA.x).toBeLessThan(nodeB.x);
    expect(nodeB.x).toBeLessThan(nodeC.x);

    // All nodes at same y (linear flow, same rank)
    expect(nodeA.y).toBe(nodeB.y);
    expect(nodeB.y).toBe(nodeC.y);

    // Edges should have points
    for (const edge of result.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    }

    // Width and height should be positive
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("lays out a branching flow A→B, A→C, B→D, C→D with vertical stacking", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "start", status: "complete", blockedBy: [] },
      { id: "b", label: "branch-1", status: "running", blockedBy: ["a"] },
      { id: "c", label: "branch-2", status: "running", blockedBy: ["a"] },
      { id: "d", label: "merge", status: "pending", blockedBy: ["b", "c"] },
    ];

    const result = computeLayout(steps);

    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(4); // a→b, a→c, b→d, c→d

    const nodeA = result.nodes.find(n => n.id === "a")!;
    const nodeB = result.nodes.find(n => n.id === "b")!;
    const nodeC = result.nodes.find(n => n.id === "c")!;
    const nodeD = result.nodes.find(n => n.id === "d")!;

    // A and D should be at different x positions (different ranks)
    expect(nodeA.x).toBeLessThan(nodeB.x);
    expect(nodeB.x).toBeLessThan(nodeD.x);

    // B and C should be at the same x (same rank) but different y (stacked)
    expect(nodeB.x).toBe(nodeC.x);
    expect(nodeB.y).not.toBe(nodeC.y);
  });

  it("places no-blockedBy parallel roots in the same rank (no false serialization)", () => {
    // Two roots, no blockedBy, no separator between them. The engine runs both
    // in wave 1 (parallel); the layout must NOT synthesize an impl→docs edge that
    // pushes them into consecutive ranks (would read as sequential).
    const steps: FlowGraphStep[] = [
      { id: "impl", label: "impl", status: "running", blockedBy: [] },
      { id: "docs", label: "docs", status: "running", blockedBy: [] },
    ];
    const result = computeLayout(steps);
    expect(result.edges).toHaveLength(0);
    const impl = result.nodes.find(n => n.id === "impl")!;
    const docs = result.nodes.find(n => n.id === "docs")!;
    expect(impl.x).toBe(docs.x); // same rank
    expect(impl.y).not.toBe(docs.y); // stacked vertically = parallel
  });

  it("handles single-step flow", () => {
    const steps: FlowGraphStep[] = [
      { id: "solo", label: "solo-step", status: "running", blockedBy: [] },
    ];

    const result = computeLayout(steps);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.width).toBeGreaterThan(0);
  });

  it("marks a returning on_error route as a red loop-styled edge (isError + isReturning)", () => {
    const steps: FlowGraphStep[] = [
      { id: "validate", label: "validate", status: "complete", blockedBy: [], type: "code-decision", onError: "fixup" },
      { id: "transform", label: "transform", status: "running", blockedBy: ["validate"] },
      { id: "fixup", label: "fixup", status: "pending", blockedBy: [], onComplete: "validate" },
    ];
    const result = computeLayout(steps);
    const e = result.edges.find(ed => ed.source === "validate" && ed.target === "fixup");
    expect(e).toBeTruthy();
    expect(e!.isError).toBe(true);
    expect(e!.isReturning).toBe(true);
    // dagre-routed: multi-segment polyline (does not cross the band naively)
    expect(e!.points.length).toBeGreaterThanOrEqual(2);
  });

  it("collapses terminal on_error handlers into a single sink node", () => {
    // `notify` is error-only: the fork loop `f` never falls through into it.
    // See change: fix-flow-graph-engine-order (error-only sink rule).
    const steps: FlowGraphStep[] = [
      { id: "a", label: "a", status: "complete", blockedBy: [], type: "code", onError: "notify" },
      { id: "b", label: "b", status: "running", blockedBy: [], type: "code", onError: "notify" },
      { id: "f", label: "f", status: "pending", blockedBy: [], type: "fork", branches: { again: "a" } },
      { id: "notify", label: "notify", status: "pending", blockedBy: [], type: "code" },
    ];
    const result = computeLayout(steps);
    expect(result.errorSink).toBeTruthy();
    expect(result.errorSink!.handlers).toEqual(["notify"]);
    // the terminal handler is NOT laid out as a normal node
    expect(result.nodes.some(n => n.id === "notify")).toBe(false);
    // both terminal routes are present as error edges (routed to the sink)
    expect(result.edges.filter(e => e.isError).map(e => e.source).sort()).toEqual(["a", "b"]);
  });

  it("removes error routes and error-only nodes from layout when showErrorRoutes is false (zero footprint)", () => {
    // Baseline = the same flow with the error-only node and its route removed
    // (the layout input must hold no error edges / error-only nodes).
    const withErr: FlowGraphStep[] = [
      { id: "a", label: "a", status: "complete", blockedBy: [], type: "code", onError: "notify" },
      { id: "f", label: "f", status: "running", blockedBy: [], type: "fork", branches: { again: "a" } },
      { id: "notify", label: "notify", status: "pending", blockedBy: [], type: "code" },
    ];
    const baseline: FlowGraphStep[] = [
      { id: "a", label: "a", status: "complete", blockedBy: [], type: "code" },
      { id: "f", label: "f", status: "running", blockedBy: [], type: "fork", branches: { again: "a" } },
    ];
    const off = computeLayout(withErr, { showErrorRoutes: false });
    const base = computeLayout(baseline);
    expect(off.errorSink).toBeUndefined();
    expect(off.edges.some(e => e.isError)).toBe(false);
    expect(off.nodes.some(n => n.id === "notify")).toBe(false);
    // a success loop (a ⇄ f) is never error-only
    expect(off.nodes.map(n => n.id).sort()).toEqual(["a", "f"]);
    expect(off.height).toBe(base.height);
  });

  it("handles empty steps array", () => {
    const result = computeLayout([]);
    // Should return empty layout without throwing
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("uses consistent node dimensions", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "step-a", status: "pending", blockedBy: [] },
      { id: "b", label: "step-b", status: "pending", blockedBy: ["a"] },
    ];

    const result = computeLayout(steps);
    // All nodes should have same width and height
    expect(result.nodes[0].width).toBe(result.nodes[1].width);
    expect(result.nodes[0].height).toBe(result.nodes[1].height);
    expect(result.nodes[0].width).toBeGreaterThan(0);
    expect(result.nodes[0].height).toBeGreaterThan(0);
  });

  it("preserves status on positioned nodes", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "step-a", status: "complete", blockedBy: [] },
      { id: "b", label: "step-b", status: "error", blockedBy: ["a"] },
    ];

    const result = computeLayout(steps);
    expect(result.nodes.find(n => n.id === "a")!.status).toBe("complete");
    expect(result.nodes.find(n => n.id === "b")!.status).toBe("error");
  });

  it("edges carry source/target status for styling", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "step-a", status: "complete", blockedBy: [] },
      { id: "b", label: "step-b", status: "running", blockedBy: ["a"] },
    ];

    const result = computeLayout(steps);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceStatus).toBe("complete");
    expect(result.edges[0].targetStatus).toBe("running");
  });

  it("layout dimensions are consistent regardless of step count", () => {
    // Single node
    const single = computeLayout([
      { id: "a", label: "step-a", status: "pending", blockedBy: [] },
    ]);
    // Many nodes
    const many = computeLayout([
      { id: "a", label: "step-a", status: "pending", blockedBy: [] },
      { id: "b", label: "step-b", status: "pending", blockedBy: ["a"] },
      { id: "c", label: "step-c", status: "pending", blockedBy: ["b"] },
      { id: "d", label: "step-d", status: "pending", blockedBy: ["c"] },
    ]);
    // Nodes should have identical dimensions in both layouts (fixed-scale)
    expect(single.nodes[0].width).toBe(many.nodes[0].width);
    expect(single.nodes[0].height).toBe(many.nodes[0].height);
    // Multi-node layout should be wider
    expect(many.width).toBeGreaterThan(single.width);
  });

  it("ignores blockedBy references to non-existent steps", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "step-a", status: "pending", blockedBy: ["nonexistent"] },
    ];

    const result = computeLayout(steps);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0); // no edge for missing dep
  });

  it("preserves type field on positioned nodes", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "agent-step", status: "pending", blockedBy: [], type: "agent" },
      { id: "b", label: "decision-step", status: "pending", blockedBy: ["a"], type: "code-decision" },
    ];

    const result = computeLayout(steps);
    expect(result.nodes.find(n => n.id === "a")!.type).toBe("agent");
    expect(result.nodes.find(n => n.id === "b")!.type).toBe("code-decision");
  });

  it("renders forward decision-branch edges with labels while running", () => {
    const steps: FlowGraphStep[] = [
      { id: "choose", label: "choose", status: "running", blockedBy: [], type: "fork", branches: { PathA: "a", PathB: "b" } },
      { id: "a", label: "a", status: "pending", blockedBy: [] },
      { id: "b", label: "b", status: "pending", blockedBy: [] },
    ];
    const result = computeLayout(steps);
    const labels = result.edges.map(e => e.label).sort();
    expect(result.edges).toHaveLength(2);
    expect(labels).toEqual(["PathA", "PathB"]);
  });

  it("marks a backward branch as a loop edge, routed by dagre (not a hand-arc)", () => {
    const steps: FlowGraphStep[] = [
      { id: "work", label: "work", status: "complete", blockedBy: [] },
      { id: "gate", label: "gate", status: "running", blockedBy: ["work"], type: "code-decision", branches: { again: "work", go: "done" } },
      { id: "done", label: "done", status: "pending", blockedBy: [] },
    ];
    const result = computeLayout(steps);
    // Backward branch gate->work is a loop-styled edge (isLoop), routed by dagre.
    const loop = result.edges.find(e => e.source === "gate" && e.target === "work");
    expect(loop).toBeTruthy();
    expect(loop!.isLoop).toBe(true);
    expect(loop!.label).toBe("again");
    expect(loop!.points.length).toBeGreaterThanOrEqual(2);
    // forward branch gate->done carries its label and is not a loop.
    const fwd = result.edges.find(e => e.source === "gate" && e.target === "done");
    expect(fwd?.label).toBe("go");
    expect(fwd?.isLoop).toBeFalsy();
  });
});

// ── pi-flows 0.10 status words (E30, E31). See change: update-flows-plugin. ──

function card(stepId: string, status: FlowAgentState["status"], extra: Partial<FlowAgentState> = {}): FlowAgentState {
  return { agentName: stepId, stepId, status, blockedBy: [], recentTools: [], detailHistory: [], ...extra };
}
function stateWith(over: Partial<FlowState>, cards: FlowAgentState[]): FlowState {
  return {
    flowName: "f",
    task: "t",
    status: "running",
    autonomousMode: false,
    agents: new Map(cards.map((c) => [c.stepId, c])),
    dagSteps: cards.map((c) => ({ id: c.stepId, stepType: c.stepId === "triage" ? "agent-decision" : "agent", agent: c.agentName, blockedBy: [] })),
    ...over,
  };
}
function renderGraph(state: FlowState) {
  const { container } = render(
    createElement(UiPrimitiveProvider, {
      value: registry,
      children: createElement(FlowGraph, { steps: flowStateToGraphSteps(state) }),
    }),
  );
  return container;
}
function nodeText(container: HTMLElement, id: string): string {
  return container.querySelector(`[data-node="${id}"] text`)?.textContent ?? "";
}

describe("graph status words (E30)", () => {
  const items = (n: number, failed: number) =>
    Array.from({ length: n }, (_, i) => card("review", i < failed ? "error" : "complete", { itemIndex: i }));
  it.each([
    [3, 0, "review · x3"],
    [3, 1, "review · x3 (1 failed)"],
    [1, 0, "review · x1"],
  ])("fan-out of %i with %i failed reads %s", (n, failed, text) => {
    const c = renderGraph(stateWith({ groups: { review: items(n, failed) } }, [card("review", failed ? "error" : "complete")]));
    expect(nodeText(c, "review")).toBe(text);
  });

  it("a skipped step reads `skipped` and uses the pending style", () => {
    const c = renderGraph(stateWith({}, [card("doc", "skipped")]));
    expect(nodeText(c, "doc")).toBe("doc · skipped");
    const pending = renderGraph(stateWith({}, [card("doc", "pending")]));
    const rect = (el: HTMLElement) => el.querySelector('[data-node="doc"] rect')?.getAttribute("fill");
    expect(rect(c)).toBe(rect(pending));
    expect(c.querySelector('[data-node="doc"]')?.getAttribute("data-status")).toBe("skipped");
  });

  it("a card-less skipped step (decision target) reads skipped", () => {
    const s = stateWith({ skippedSteps: ["gate"] }, [card("triage", "complete")]);
    s.dagSteps!.push({ id: "gate", stepType: "code", blockedBy: [] });
    const c = renderGraph(s);
    expect(nodeText(c, "gate")).toBe("gate · skipped");
  });

  it.each([
    [[{ branch: "fix" }], "triage · fix"],
    [[{ branch: "fix" }, { branch: "doc" }], "triage · fix, doc"],
  ])("a decision shows its chosen routes", (routes, text) => {
    const c = renderGraph(
      stateWith({ decisions: { triage: { routes, chosenTargets: [], notTaken: [] } } }, [card("triage", "complete")]),
    );
    expect(nodeText(c, "triage")).toBe(text);
  });

  it("the step name is the first text in every node", () => {
    const c = renderGraph(
      stateWith({ groups: { review: items(3, 1) }, decisions: { triage: { routes: [{ branch: "fix" }], chosenTargets: [], notTaken: [] } } }, [
        card("review", "error"),
        card("triage", "complete"),
        card("doc", "skipped"),
      ]),
    );
    for (const id of ["review", "triage", "doc"]) expect(nodeText(c, id).startsWith(id)).toBe(true);
  });
});

describe("graph stays minimal (E31)", () => {
  it("never renders item output, decision labels or per-item results", () => {
    const s = stateWith(
      {
        groups: { review: [card("review", "complete", { itemIndex: 0, summary: "RESULT-XYZ" })] },
        decisions: { triage: { labels: ["bug found"], routes: [{ branch: "fix" }], chosenTargets: ["fix"], notTaken: [] } },
      },
      [card("review", "complete", { summary: "RESULT-XYZ" }), card("triage", "complete")],
    );
    const c = renderGraph(s);
    const text = c.textContent ?? "";
    expect(text).not.toContain("RESULT-XYZ");
    expect(text).not.toContain("bug found");
    expect(c.querySelector('[data-node*="flow-ref"]')).toBeNull();
  });
});

// ── Engine-order layout. See change: fix-flow-graph-engine-order. ──

const asGraph = (steps: FlowEdgeStep[]): FlowGraphStep[] =>
  steps.map((s) => ({
    id: s.id,
    label: s.id,
    status: "pending",
    blockedBy: s.blockedBy,
    kind: s.type,
    type: mapStepType(s.type),
    branches: s.branches,
    onError: s.onError,
    onComplete: s.onComplete,
  }));
const nodeIds = (r: ReturnType<typeof computeLayout>) => r.nodes.map((n) => n.id);
const edgesOn = (r: ReturnType<typeof computeLayout>, from: string, to: string) =>
  r.edges.filter((e) => e.source === from && e.target === to);

describe("computeLayout — engine order + error-only sink", () => {
  it("E15: a terminal target on the success path stays a normal node (SD4)", () => {
    for (const showErrorRoutes of [false, true]) {
      const r = computeLayout(asGraph(SD4), { showErrorRoutes });
      expect(nodeIds(r)).toContain("report");
      expect(edgesOn(r, "start", "report").length).toBeGreaterThan(0);
      expect(r.errorSink?.handlers ?? []).not.toContain("report");
    }
  });

  it("E16: a terminal handler and its error-only tail pool into the sink", () => {
    // `z` is a fork loop (never falls through), so `cleanup` is reached only via
    // on_error and `notify` only via `cleanup`.
    const steps = asGraph([
      { id: "a", type: "code", blockedBy: [], onError: "cleanup" },
      { id: "z", type: "fork", blockedBy: [], branches: { again: "a" } },
      { id: "cleanup", type: "code", blockedBy: [] },
      { id: "notify", type: "code", blockedBy: [] },
    ]);
    const r = computeLayout(steps, { showErrorRoutes: true });
    expect(nodeIds(r)).not.toContain("cleanup");
    expect(nodeIds(r)).not.toContain("notify");
    expect(r.errorSink?.handlers).toEqual(["cleanup", "notify"]);
  });

  it("E17: a root is never error-only (NTI)", () => {
    expect(nodeIds(computeLayout(asGraph(NTI), { showErrorRoutes: false }))).toContain("read");
  });

  it("E18: a handler that is also a branch target stays visible (UPD)", () => {
    const r = computeLayout(asGraph(UPD), { showErrorRoutes: false });
    expect(nodeIds(r)).toContain("resolve");
    expect(edgesOn(r, "rebase", "resolve")).toHaveLength(1);
    expect(r.errorSink?.handlers ?? []).not.toContain("resolve");
  });

  it("E19: an in-segment on_error target stays visible", () => {
    const r = computeLayout(asGraph(IN_SEGMENT_ON_ERROR), { showErrorRoutes: false });
    expect(nodeIds(r)).toContain("b");
    expect(edgesOn(r, "a", "b")).toHaveLength(1);
  });

  it("E20: a fall-through and an on_error route on one pair are both laid out (UPD)", () => {
    const on = computeLayout(asGraph(UPD), { showErrorRoutes: true });
    const lr = edgesOn(on, "launch", "report");
    expect(lr).toHaveLength(2);
    for (const e of lr) expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(lr.filter((e) => e.isError)).toHaveLength(1);
    expect(on.edges).toHaveLength(deriveFlowEdges(UPD).length);

    const off = computeLayout(asGraph(UPD), { showErrorRoutes: false });
    expect(edgesOn(off, "launch", "report")).toEqual([expect.objectContaining({ kind: "implicit", isError: false })]);
  });

  it("E21: a hidden error layer costs no layout (CC10)", () => {
    const r = computeLayout(asGraph(CC10), { showErrorRoutes: false });
    expect(r.edges.some((e) => e.isError)).toBe(false);
    expect(nodeIds(r)).not.toContain("fail");
    expect(r.edges.some((e) => e.source === "fail")).toBe(false);
  });

  it("E22: a mid-flow handler reached by fall-through stays visible", () => {
    const r = computeLayout(
      asGraph([
        { id: "a", type: "code", blockedBy: [], onError: "h" },
        { id: "b", type: "code", blockedBy: [] },
        { id: "h", type: "code", blockedBy: [] },
        { id: "z", type: "code", blockedBy: [] },
      ]),
      { showErrorRoutes: false },
    );
    expect(nodeIds(r)).toContain("h");
    expect(edgesOn(r, "b", "h")).toHaveLength(1);
  });

  it.each([
    ["agent-decision", 1],
    ["fork", 0],
  ])("E23: the live path keeps the raw kind (%s loop → %i fall-through edges)", (stepType, count) => {
    const state: FlowState = {
      flowName: "f",
      task: "t",
      status: "running",
      autonomousMode: false,
      agents: new Map(),
      dagSteps: [
        { id: "a", stepType: "agent", agent: "a", blockedBy: [] },
        { id: "d", stepType, agent: "d", blockedBy: [], branches: { retry: "a" } },
        { id: "x", stepType: "code", blockedBy: [] },
      ],
    };
    const r = computeLayout(flowStateToGraphSteps(state));
    expect(edgesOn(r, "d", "x")).toHaveLength(count);
  });

  it("X2: empty and single-step flows", () => {
    expect(deriveFlowEdges([])).toEqual([]);
    const empty = computeLayout([]);
    expect(empty.edges).toEqual([]);
    const single = computeLayout(asGraph([{ id: "a", type: "code", blockedBy: [] }]));
    expect(single.nodes).toHaveLength(1);
    expect(single.edges).toHaveLength(0);
    expect(single.errorSink).toBeUndefined();
  });

  it("renders a data-edge attribute per edge", () => {
    const steps = asGraph([
      { id: "a", type: "code", blockedBy: [] },
      { id: "b", type: "code", blockedBy: [] },
    ]);
    const { container } = render(
      createElement(UiPrimitiveProvider, { value: registry, children: createElement(FlowGraph, { steps }) }),
    );
    expect(container.querySelector('[data-edge="a>b"]')).not.toBeNull();
  });
});
