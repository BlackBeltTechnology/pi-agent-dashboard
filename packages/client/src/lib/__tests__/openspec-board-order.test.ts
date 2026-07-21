/**
 * Tests for per-change board ordering. See change: redesign-openspec-board
 * (openspec-change-order spec).
 */
import { describe, it, expect } from "vitest";
import { defaultChangeSort, orderChangesForGroup, computeReorder } from "../openspec/openspec-board-order.js";
import type { OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ch(name: string, status: OpenSpecChange["status"]): OpenSpecChange {
  return { name, status, completedTasks: 0, totalTasks: 0, artifacts: [] };
}

describe("defaultChangeSort", () => {
  it("orders in-progress before others before complete, then by name", () => {
    const list = [
      ch("z-complete", "complete"),
      ch("a-notasks", "no-tasks"),
      ch("m-progress", "in-progress"),
      ch("b-progress", "in-progress"),
    ];
    const sorted = [...list].sort(defaultChangeSort).map((c) => c.name);
    expect(sorted).toEqual(["b-progress", "m-progress", "a-notasks", "z-complete"]);
  });
});

describe("orderChangesForGroup", () => {
  const changes = [ch("a-change", "in-progress"), ch("b-change", "in-progress"), ch("c-change", "no-tasks")];

  it("falls back to default sort when order absent (never errors)", () => {
    expect(orderChangesForGroup(changes, undefined).map((c) => c.name)).toEqual(["a-change", "b-change", "c-change"]);
    expect(orderChangesForGroup(changes, []).map((c) => c.name)).toEqual(["a-change", "b-change", "c-change"]);
  });

  it("renders persisted order first, then unordered by default sort", () => {
    const out = orderChangesForGroup(changes, ["b-change"]).map((c) => c.name);
    expect(out).toEqual(["b-change", "a-change", "c-change"]);
  });

  it("ignores stale order entries no longer in the group", () => {
    const out = orderChangesForGroup(changes, ["gone", "b-change"]).map((c) => c.name);
    expect(out).toEqual(["b-change", "a-change", "c-change"]);
  });

  it("appends a newly-created change deterministically without disturbing stored order", () => {
    const full = [...changes, ch("new-change", "no-tasks")];
    const out = orderChangesForGroup(full, ["b-change", "a-change"]).map((c) => c.name);
    // stored [b,a] preserved; c + new appended by default sort
    expect(out).toEqual(["b-change", "a-change", "c-change", "new-change"]);
  });
});

describe("computeReorder", () => {
  it("moves an item to the target index (move keeps target position)", () => {
    expect(computeReorder(["x", "a-change", "y"], "add-auth", 1)).toEqual(["x", "add-auth", "a-change", "y"]);
  });

  it("reorders within the same list", () => {
    expect(computeReorder(["a-change", "fix-bug"], "fix-bug", 0)).toEqual(["fix-bug", "a-change"]);
  });

  it("clamps out-of-range indices", () => {
    expect(computeReorder(["a", "b"], "c", 99)).toEqual(["a", "b", "c"]);
    expect(computeReorder(["a", "b"], "c", -5)).toEqual(["c", "a", "b"]);
  });
});
