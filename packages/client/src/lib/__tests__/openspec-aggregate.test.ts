import { describe, it, expect } from "vitest";
import { aggregateOpenSpec } from "../openspec-aggregate.js";
import type { OpenSpecData, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function change(name: string, extra: Partial<OpenSpecChange> = {}): OpenSpecChange {
  return {
    name,
    status: "in-progress",
    completedTasks: 0,
    totalTasks: 1,
    artifacts: [],
    ...extra,
  };
}

function data(changes: OpenSpecChange[], extra: Partial<OpenSpecData> = {}): OpenSpecData {
  return { initialized: true, changes, ...extra };
}

const MAIN = "/repo";
const WORKTREE = "/repo/.worktrees/feat-x";

describe("aggregateOpenSpec", () => {
  it("main-only: returns group cwd changes tagged with sourceCwd", () => {
    const map = new Map<string, OpenSpecData>([[MAIN, data([change("a"), change("b")])]]);
    const result = aggregateOpenSpec(MAIN, [MAIN], map);
    expect(result.changes.map((c) => c.name)).toEqual(["a", "b"]);
    expect(result.changes.every((c) => c.sourceCwd === MAIN)).toBe(true);
    expect(result.initialized).toBe(true);
  });

  it("worktree-only: appends worktree change tagged with its cwd", () => {
    const map = new Map<string, OpenSpecData>([
      [MAIN, data([change("a"), change("b")])],
      [WORKTREE, data([change("c")])],
    ]);
    const result = aggregateOpenSpec(MAIN, [WORKTREE], map);
    expect(result.changes.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(result.changes.find((c) => c.name === "c")?.sourceCwd).toBe(WORKTREE);
  });

  it("collision: group cwd wins, change appears once from group cwd", () => {
    const map = new Map<string, OpenSpecData>([
      [MAIN, data([change("a", { completedTasks: 5 })])],
      [WORKTREE, data([change("a", { completedTasks: 0 }), change("c")])],
    ]);
    const result = aggregateOpenSpec(MAIN, [WORKTREE], map);
    expect(result.changes.map((c) => c.name)).toEqual(["a", "c"]);
    const a = result.changes.find((c) => c.name === "a")!;
    expect(a.sourceCwd).toBe(MAIN);
    expect(a.completedTasks).toBe(5);
  });

  it("OR-folds initialized / pending / hasOpenspecDir across member cwds", () => {
    const map = new Map<string, OpenSpecData>([
      [MAIN, data([], { initialized: false, pending: false })],
      [WORKTREE, data([change("c")], { initialized: false, pending: true })],
    ]);
    const result = aggregateOpenSpec(MAIN, [WORKTREE], map);
    expect(result.initialized).toBe(false);
    expect(result.pending).toBe(true);
  });

  it("de-dupes repeated member cwds", () => {
    const map = new Map<string, OpenSpecData>([[MAIN, data([change("a")])]]);
    const result = aggregateOpenSpec(MAIN, [MAIN, MAIN], map);
    expect(result.changes.map((c) => c.name)).toEqual(["a"]);
  });
});
