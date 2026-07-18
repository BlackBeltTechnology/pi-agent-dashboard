/**
 * Tests for worktree progress/delta derivation on board session rows.
 * See change: redesign-openspec-board (openspec-card-section worktree spec).
 */
import { describe, it, expect } from "vitest";
import { deriveWorktreeProgress } from "../openspec/openspec-board-worktree.js";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function sess(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1", cwd: "/repo/.worktrees/os-x", source: "tui", status: "active", startedAt: 0,
    ...over,
  };
}

function wtData(name: string, done: number, total: number): OpenSpecData {
  return { initialized: true, changes: [{ name, status: "in-progress", completedTasks: done, totalTasks: total, artifacts: [] }] };
}

describe("deriveWorktreeProgress", () => {
  it("returns null for a non-worktree session", () => {
    expect(deriveWorktreeProgress(sess({ gitWorktree: undefined }), "feat", 3, new Map())).toBeNull();
  });

  it("ahead: worktree 9/14 vs main 6 → +3 delta", () => {
    const s = sess({ cwd: "/wt", gitWorktree: { mainPath: "/repo", name: "os/x", base: "main" } });
    const map = new Map([["/wt", wtData("feat", 9, 14)]]);
    const r = deriveWorktreeProgress(s, "feat", 6, map)!;
    expect(r.name).toBe("os/x");
    expect(r.base).toBe("main");
    expect(r.done).toBe(9);
    expect(r.total).toBe(14);
    expect(r.delta).toBe(3);
  });

  it("behind: worktree 5/14 vs main 8 → -3 delta", () => {
    const s = sess({ cwd: "/wt", gitWorktree: { mainPath: "/repo", name: "os/x" } });
    const map = new Map([["/wt", wtData("feat", 5, 14)]]);
    const r = deriveWorktreeProgress(s, "feat", 8, map)!;
    expect(r.done).toBe(5);
    expect(r.delta).toBe(-3);
  });

  it("returns null progress fields when the worktree has no data for the change", () => {
    const s = sess({ cwd: "/wt", gitWorktree: { mainPath: "/repo", name: "os/x" } });
    const r = deriveWorktreeProgress(s, "feat", 4, new Map())!;
    expect(r.name).toBe("os/x");
    expect(r.done).toBeNull();
    expect(r.total).toBeNull();
    expect(r.delta).toBeNull();
  });
});
