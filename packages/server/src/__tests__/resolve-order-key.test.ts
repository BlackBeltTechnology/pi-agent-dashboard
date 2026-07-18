import { describe, it, expect } from "vitest";
import { resolveOrderKey } from "../session/resolve-order-key.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function session(partial: Partial<DashboardSession>): DashboardSession {
  return { id: "s", cwd: "/repo", status: "active", startedAt: 0, ...partial } as DashboardSession;
}

describe("resolveOrderKey", () => {
  it("plain checkout: key equals cwd", () => {
    expect(resolveOrderKey(session({ cwd: "/repo" }), [], "linux")).toBe("/repo");
  });

  it("worktree: key equals gitWorktree.mainPath", () => {
    const s = session({
      cwd: "/repo/.worktrees/feat-x",
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    expect(resolveOrderKey(s, [], "linux")).toBe("/repo");
  });

  it("explicit pin of the worktree cwd wins over worktree collapse", () => {
    const s = session({
      cwd: "/repo/.worktrees/feat-x",
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    expect(resolveOrderKey(s, ["/repo/.worktrees/feat-x"], "linux")).toBe(
      "/repo/.worktrees/feat-x",
    );
  });
});
