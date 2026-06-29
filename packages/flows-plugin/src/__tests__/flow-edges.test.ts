import { describe, it, expect } from "vitest";
import { deriveFlowEdges, type FlowEdgeStep } from "../client/flow-edges.js";

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

  it("skips edges with missing endpoints", () => {
    const edges = deriveFlowEdges([
      { id: "a", type: "agent", blockedBy: ["ghost"], branches: { x: "nowhere" } },
    ]);
    expect(edges).toHaveLength(0);
  });

  it("live (branches only) and static (branches + routes) agree on shared classes", () => {
    const base: FlowEdgeStep[] = [
      { id: "a", type: "agent", blockedBy: [] },
      { id: "fork", type: "fork", blockedBy: ["a"], branches: { p: "b", q: "c" } },
      { id: "b", type: "agent", blockedBy: [] },
      { id: "c", type: "agent", blockedBy: [] },
    ];
    const live = deriveFlowEdges(base);
    const staticEdges = deriveFlowEdges(base.map((s) => ({ ...s, onError: s.id === "b" ? "c" : undefined })));
    const sharedLive = live.filter((e) => e.kind !== "route").map(key).sort();
    const sharedStatic = staticEdges.filter((e) => e.kind !== "route").map(key).sort();
    expect(sharedLive).toEqual(sharedStatic);
  });
});
