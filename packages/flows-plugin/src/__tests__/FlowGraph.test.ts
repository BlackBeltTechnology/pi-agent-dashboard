import { describe, it, expect } from "vitest";
import { computeLayout, type FlowGraphStep } from "../client/FlowGraph.js";

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

  it("handles single-step flow", () => {
    const steps: FlowGraphStep[] = [
      { id: "solo", label: "solo-step", status: "running", blockedBy: [] },
    ];

    const result = computeLayout(steps);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.width).toBeGreaterThan(0);
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

  it("preserves type field on positioned nodes for flow-ref steps", () => {
    const steps: FlowGraphStep[] = [
      { id: "a", label: "agent-step", status: "pending", blockedBy: [], type: "agent" },
      { id: "b", label: "subflow-step", status: "pending", blockedBy: ["a"], type: "flow-ref" },
    ];

    const result = computeLayout(steps);
    expect(result.nodes.find(n => n.id === "a")!.type).toBe("agent");
    expect(result.nodes.find(n => n.id === "b")!.type).toBe("flow-ref");
  });
});
