import { describe, expect, it } from "vitest";
import { deriveFlowEdges, type FlowEdge, type FlowEdgeStep } from "../client/flow-edges.js";
import { CC10, IN_SEGMENT_ON_ERROR, NTI, SD4, UPD } from "./engine-order-fixtures.js";

const key = (e: { from: string; to: string }) => `${e.from}->${e.to}`;

describe("deriveFlowEdges", () => {
  it("derives the four edge classes", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "b", type: "code", blockedBy: ["a"], onComplete: "d" }, // sequential a->b, route b->d
      { id: "d", type: "code-decision", blockedBy: ["b"], branches: { again: "b" } }, // branch d->b (back)
      { id: "sep", type: "fork", blockedBy: ["d"] },
      { id: "e", type: "agent", blockedBy: [] }, // implicit sep->e (no other incoming)
    ];
    const edges = deriveFlowEdges(steps);
    const byKey = new Map(edges.map((e) => [key(e), e]));

    expect(byKey.get("a->b")?.kind).toBe("sequential");
    expect(byKey.get("d->b")?.kind).toBe("branch");
    expect(byKey.get("d->b")?.label).toBe("again");
    expect(byKey.get("sep->e")?.kind).toBe("implicit");
    expect(byKey.get("b->d")?.kind).toBe("route");
  });

  it("does not serialize parallel siblings (no separator predecessor)", () => {
    // Three roots with no blockedBy and no separator between them: the engine
    // runs all three in wave 1 (parallel). No implicit chain should be drawn.
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "impl", type: "agent", blockedBy: [] },
      { id: "docs", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges).toHaveLength(0);
  });

  it("keeps the implicit edge across a separator boundary", () => {
    // A step with no blockedBy immediately after a separator falls through from it.
    const steps: FlowEdgeStep[] = [
      { id: "decide", type: "code-decision", blockedBy: [] },
      { id: "next", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.find((e) => key(e) === "decide->next")?.kind).toBe("implicit");
  });

  it("fans all no-blockedBy roots out from the preceding separator (parallel)", () => {
    // Two parallel roots after one separator: BOTH fall through from the
    // separator (parallel), not chained b->c.
    const steps: FlowEdgeStep[] = [
      { id: "sep", type: "fork", blockedBy: [] },
      { id: "b", type: "agent", blockedBy: [] },
      { id: "c", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.find((e) => key(e) === "sep->b")?.kind).toBe("implicit");
    expect(edges.find((e) => key(e) === "sep->c")?.kind).toBe("implicit");
    expect(edges.some((e) => key(e) === "b->c")).toBe(false);
  });

  it("flags backward edges", () => {
    const steps: FlowEdgeStep[] = [
      { id: "work", type: "agent", blockedBy: [] },
      { id: "gate", type: "code-decision", blockedBy: ["work"], branches: { again: "work", go: "done" } },
      { id: "done", type: "agent", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const back = edges.find((e) => key(e) === "gate->work")!;
    const fwd = edges.find((e) => key(e) === "gate->done")!;
    expect(back.backward).toBe(true);
    expect(fwd.backward).toBe(false);
  });

  it("collapses duplicate {from,to}, preferring labeled branch", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "fork", blockedBy: [], branches: { x: "b" } },
      { id: "b", type: "agent", blockedBy: ["a"] }, // sequential a->b AND branch a->b
    ];
    const edges = deriveFlowEdges(steps);
    const ab = edges.filter((e) => key(e) === "a->b");
    expect(ab).toHaveLength(1);
    expect(ab[0].kind).toBe("branch");
    expect(ab[0].label).toBe("x");
  });

  it("emits route edges only when onComplete/onError present", () => {
    const withRoute = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [], onComplete: "b" },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    expect(withRoute.find((e) => key(e) === "a->b")?.kind).toBe("route");

    const liveNoRoute = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [] },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    expect(liveNoRoute.some((e) => e.kind === "route")).toBe(false);
  });

  it("classifies an on_error route as returning when the handler rejoins the flow", () => {
    const steps: FlowEdgeStep[] = [
      { id: "validate", type: "code-decision", blockedBy: [], onError: "fixup" },
      { id: "transform", type: "agent", blockedBy: ["validate"] },
      { id: "fixup", type: "agent", blockedBy: [], onComplete: "validate" }, // rejoins the spine
    ];
    const r = deriveFlowEdges(steps).find((e) => key(e) === "validate->fixup")!;
    expect(r.kind).toBe("route");
    expect(r.label).toBe("on_error");
    expect(r.routeTopology).toBe("returning");
  });

  it("classifies an on_error route as terminal when the handler never rejoins", () => {
    const steps: FlowEdgeStep[] = [
      { id: "finalize", type: "agent", blockedBy: [], onError: "notify" },
      { id: "notify", type: "agent", blockedBy: [] }, // sink: no forward edge back to the flow
    ];
    const r = deriveFlowEdges(steps).find((e) => key(e) === "finalize->notify")!;
    expect(r.kind).toBe("route");
    expect(r.routeTopology).toBe("terminal");
  });

  it("leaves routeTopology unset on non-on_error routes", () => {
    const edges = deriveFlowEdges([
      { id: "a", type: "code", blockedBy: [], onComplete: "b" },
      { id: "b", type: "agent", blockedBy: [] },
    ]);
    const oc = edges.find((e) => key(e) === "a->b")!;
    expect(oc.kind).toBe("route");
    expect(oc.routeTopology).toBeUndefined();
  });

  it("skips edges with missing endpoints", () => {
    const edges = deriveFlowEdges([
      { id: "a", type: "agent", blockedBy: ["ghost"], branches: { x: "nowhere" } },
    ]);
    expect(edges).toHaveLength(0);
  });

  // Regression: a flow wired entirely via on_complete (no blockedBy), with a
  // routing step declared BEFORE any separator — the InvoiceBot `process` shape.
  // The pre-separator root must NOT be orphaned, and a routing target must not
  // also get a spurious implicit edge from the nearest separator.
  // See change: fix-flow-ui-graph-zoom-summary.
  it("on_complete-routed pre-separator root is connected (no orphan)", () => {
    const steps: FlowEdgeStep[] = [
      { id: "load-state", type: "code", blockedBy: [], onComplete: "resume-gate", onError: "hold" },
      { id: "resume-gate", type: "code-decision", blockedBy: [], branches: { new: "intake" } },
      { id: "intake", type: "code", blockedBy: [], onComplete: "hold" },
      { id: "hold", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const byKey = new Map(edges.map((e) => [key(e), e]));
    // load-state routes forward (not orphaned) and to its error sink.
    expect(byKey.get("load-state->resume-gate")?.kind).toBe("route");
    expect(byKey.get("load-state->hold")?.kind).toBe("route");
    // load-state has at least one outgoing edge.
    expect(edges.some((e) => e.from === "load-state")).toBe(true);
  });

  it("routing target suppresses a spurious implicit edge", () => {
    // `intake` has no blockedBy but is the on_complete target of `gate`; it must
    // get the route edge and NOT also an implicit edge from the separator.
    const steps: FlowEdgeStep[] = [
      { id: "gate", type: "code-decision", blockedBy: [], onComplete: "intake" },
      { id: "intake", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    const incoming = edges.filter((e) => e.to === "intake");
    expect(incoming).toHaveLength(1);
    expect(incoming[0].kind).toBe("route");
  });

  it("omitting routing fields produces no route edges (backward compat)", () => {
    const steps: FlowEdgeStep[] = [
      { id: "a", type: "code", blockedBy: [] },
      { id: "b", type: "code", blockedBy: [] },
    ];
    const edges = deriveFlowEdges(steps);
    expect(edges.some((e) => e.kind === "route")).toBe(false);
  });

  it("live and static step lists with identical data produce the same edges, routes included", () => {
    const base = (): FlowEdgeStep[] => [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "fork", type: "fork", blockedBy: ["a"], branches: { p: "b", q: "c" } },
      { id: "b", type: "agent", blockedBy: [], onError: "c" },
      { id: "c", type: "agent", blockedBy: [] },
    ];
    const live = deriveFlowEdges(base()).map((e) => `${key(e)}:${e.kind}:${e.label ?? ""}`).sort();
    const staticEdges = deriveFlowEdges(base()).map((e) => `${key(e)}:${e.kind}:${e.label ?? ""}`).sort();
    expect(live).toEqual(staticEdges);
    expect(live).toEqual([
      "a->fork:sequential:",
      "b->c:route:on_error",
      "b->c:sequential:",
      "fork->b:branch:p",
      "fork->c:branch:q",
    ]);
  });
});

// Engine fall-through semantics. See change: fix-flow-graph-engine-order.
describe("deriveFlowEdges — engine fall-through", () => {
  const pairs = (steps: FlowEdgeStep[]) => deriveFlowEdges(steps);
  const find = (edges: FlowEdge[], from: string, to: string) => edges.filter((e) => e.from === from && e.to === to);
  const hasKind = (edges: FlowEdge[], from: string, to: string, kind: string) =>
    find(edges, from, to).some((e) => e.kind === kind);

  it("E1: consecutive code steps chain in declared order (CC10)", () => {
    const edges = pairs(CC10);
    expect(hasKind(edges, "worktree", "init", "implicit")).toBe(true);
    expect(hasKind(edges, "init", "spawn", "implicit")).toBe(true);
    expect(hasKind(edges, "spawn", "record", "implicit")).toBe(true);
    for (const to of ["init", "spawn", "record"]) expect(find(edges, "pick", to)).toHaveLength(0);
  });

  it("E2: DAG sinks fall through to the next separator (NTI)", () => {
    const edges = pairs(NTI);
    expect(hasKind(edges, "triage", "cleanup", "implicit")).toBe(true);
    expect(hasKind(edges, "cleanup", "report", "implicit")).toBe(true);
    expect(find(edges, "read", "cleanup")).toHaveLength(0);
  });

  it("E3: fall-through into a step that already has incoming edges (SD4)", () => {
    const edges = pairs(SD4);
    expect(find(edges, "start", "report")).toEqual([expect.objectContaining({ kind: "branch", label: "busy" })]);
    expect(hasKind(edges, "dispatch", "retire", "implicit")).toBe(true);
    expect(hasKind(edges, "retire", "report", "implicit")).toBe(true);
  });

  it("E4: fall-through coexists with an on_error route on the same pair (UPD)", () => {
    const lr = find(pairs(UPD), "launch", "report");
    expect(lr).toHaveLength(2);
    expect(lr.filter((e) => e.kind === "implicit")).toHaveLength(1);
    expect(lr.filter((e) => e.kind === "route" && e.label === "on_error")).toHaveLength(1);
  });

  it("E5: a decision with forward branches only never falls through (SD4)", () => {
    expect(pairs(SD4).some((e) => e.from === "start" && e.kind === "implicit")).toBe(false);
  });

  it.each(["code-decision", "agent-decision"])("E6: loop-capped %s falls through", (type) => {
    const edges = pairs([
      { id: "a", type: "agent", blockedBy: [] },
      { id: "d", type, blockedBy: [], branches: { retry: "a" } },
      { id: "x", type: "code", blockedBy: [] },
    ]);
    const dx = find(edges, "d", "x");
    expect(dx).toEqual([expect.objectContaining({ kind: "implicit", backward: false })]);
  });

  it("E7: a fork loop never falls through", () => {
    const edges = pairs([
      { id: "a", type: "agent", blockedBy: [] },
      { id: "f", type: "fork", blockedBy: [], branches: { again: "a" } },
      { id: "x", type: "code", blockedBy: [] },
    ]);
    expect(find(edges, "f", "x")).toHaveLength(0);
  });

  it("E8: an in-segment on_error target is not a root", () => {
    const edges = pairs(IN_SEGMENT_ON_ERROR);
    expect(hasKind(edges, "s", "a", "implicit")).toBe(true);
    expect(hasKind(edges, "a", "b", "sequential")).toBe(true);
    expect(find(edges, "a", "b").some((e) => e.kind === "route" && e.label === "on_error")).toBe(true);
    expect(hasKind(edges, "b", "z", "implicit")).toBe(true);
    expect(find(edges, "s", "b")).toHaveLength(0);
    expect(find(edges, "a", "z")).toHaveLength(0);
  });

  it("E9: unknown or absent step types join the DAG segment", () => {
    const steps = [
      { id: "s", type: "code", blockedBy: [] },
      { id: "r", type: "flow-ref", blockedBy: [] },
      { id: "u", blockedBy: [] },
      { id: "z", type: "code", blockedBy: [] },
    ] as FlowEdgeStep[];
    const edges = pairs(steps); // must not throw
    for (const [f, t] of [["s", "r"], ["s", "u"], ["r", "z"], ["u", "z"]]) {
      expect(hasKind(edges, f, t, "implicit")).toBe(true);
    }
    expect(find(edges, "r", "u")).toHaveLength(0);
    expect(find(edges, "u", "r")).toHaveLength(0);
  });

  it("E10: agent siblings stay parallel", () => {
    const edges = pairs([
      { id: "s", type: "code", blockedBy: [] },
      { id: "a", type: "agent", blockedBy: [] },
      { id: "b", type: "agent", blockedBy: [] },
      { id: "z", type: "code", blockedBy: [] },
    ]);
    for (const [f, t] of [["s", "a"], ["s", "b"], ["a", "z"], ["b", "z"]]) {
      expect(hasKind(edges, f, t, "implicit")).toBe(true);
    }
    expect(find(edges, "a", "b")).toHaveLength(0);
    expect(find(edges, "b", "a")).toHaveLength(0);
  });

  it("E11: legacy on_complete never removes the fall-through", () => {
    const elsewhere = pairs([
      { id: "a", type: "code", blockedBy: [], onComplete: "c" },
      { id: "b", type: "code", blockedBy: [] },
      { id: "c", type: "code", blockedBy: [] },
    ]);
    expect(find(elsewhere, "a", "c")).toEqual([expect.objectContaining({ kind: "route", label: "on_complete" })]);
    expect(hasKind(elsewhere, "a", "b", "implicit")).toBe(true);

    const same = pairs([
      { id: "a", type: "code", blockedBy: [], onComplete: "b" },
      { id: "b", type: "code", blockedBy: [] },
    ]);
    expect(find(same, "a", "b")).toHaveLength(1);
  });

  it("E12: a forward-only decision before a routing target emits no implicit edge", () => {
    const edges = pairs([
      { id: "a", type: "code", blockedBy: [], onError: "h" },
      { id: "d", type: "code-decision", blockedBy: [], branches: { go: "z" } },
      { id: "h", type: "code", blockedBy: [] },
      { id: "z", type: "code", blockedBy: [] },
    ]);
    expect(find(edges, "a", "h").some((e) => e.kind === "route" && e.label === "on_error")).toBe(true);
    expect(edges.some((e) => e.from === "d" && e.kind === "implicit")).toBe(false);
  });

  it("E13: a branch and an on_error route on one pair merge into the branch (UPD)", () => {
    expect(find(pairs(UPD), "rebase", "resolve")).toEqual([
      expect.objectContaining({ kind: "branch", label: "conflict" }),
    ]);
  });

  it("E14: the last segment has no successor and non-error pairs never duplicate (NTI)", () => {
    const edges = pairs(NTI);
    expect(edges.some((e) => e.from === "report")).toBe(false);
    const nonError = edges.filter((e) => !(e.kind === "route" && e.label === "on_error")).map(key);
    expect(new Set(nonError).size).toBe(nonError.length);
  });

  it("X1: dangling branch / blockedBy refs are skipped, fall-through kept", () => {
    const edges = pairs([ // must not throw
      { id: "a", type: "code-decision", blockedBy: [], branches: { x: "ghost" } },
      { id: "b", type: "code", blockedBy: ["ghost"] },
      { id: "c", type: "code", blockedBy: [] },
    ]);
    expect(edges.some((e) => e.from === "ghost" || e.to === "ghost")).toBe(false);
    expect(hasKind(edges, "b", "c", "implicit")).toBe(true);
  });

  it("X2: empty input yields no edges; a single step yields none", () => {
    expect(pairs([])).toEqual([]);
    expect(pairs([{ id: "a", type: "code", blockedBy: [] }])).toEqual([]);
  });
});
