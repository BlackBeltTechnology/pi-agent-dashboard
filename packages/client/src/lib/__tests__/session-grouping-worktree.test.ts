/**
 * Tests for git-worktree precedence in `resolveSessionGroupPath` and
 * worktree-session grouping in `groupSessionsByDirectory`.
 *
 * Pins the §5 contract from `add-worktree-spawn-dialog` MINUS the dropped
 * cluster-adjacency (see change: simplify-session-card-ordering, D8):
 *   - Worktree session collapses under its `gitWorktree.mainPath`.
 *   - Explicit pin of the worktree path wins (pin > worktree).
 *   - Within a group, order is the flat `sessionOrder` ONLY — no cluster
 *     adjacency. A worktree session can sort ahead of the main checkout.
 */
import { describe, it, expect } from "vitest";
import type {
  DashboardSession,
  GitWorktreeInfo,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  groupSessionsByDirectory,
  resolveSessionGroupPath,
} from "../session-grouping.js";

function mk(
  id: string,
  cwd: string,
  startedAt: number,
  opts: { gitWorktree?: GitWorktreeInfo } = {},
): DashboardSession {
  const { gitWorktree } = opts;
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...(gitWorktree ? { gitWorktree } : {}),
  } as DashboardSession;
}

describe("resolveSessionGroupPath — worktree precedence (step 2)", () => {
  it("worktree session resolves to mainPath when no pin applies", () => {
    const s = mk("s", "/repo/.worktrees/feat-x", 100, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    expect(resolveSessionGroupPath(s, new Set(), "linux")).toBe("/repo");
  });

  it("explicit pin of worktree path wins over worktree collapse", () => {
    const s = mk("s", "/repo/.worktrees/feat-x", 100, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const pinnedKeys = new Set(["/repo/.worktrees/feat-x"]);
    expect(resolveSessionGroupPath(s, pinnedKeys, "linux")).toBe("/repo/.worktrees/feat-x");
  });

  it("plain checkout falls through to cwd", () => {
    const s = mk("s", "/some/path", 100);
    expect(resolveSessionGroupPath(s, new Set(), "linux")).toBe("/some/path");
  });
});

describe("groupSessionsByDirectory — worktree grouping (no clustering)", () => {
  it("worktree session collapses under pinned parent repo", () => {
    const main = mk("main", "/repo", 100);
    const wt = mk("wt", "/repo/.worktrees/feat-x", 200, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const { pinned } = groupSessionsByDirectory([main, wt], undefined, ["/repo"], "linux");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.cwd).toBe("/repo");
    expect(pinned[0]!.sessions.map((s) => s.id).sort()).toEqual(["main", "wt"]);
  });

  it("worktree session in unpinned mode also collapses under main repo", () => {
    const main = mk("main", "/repo", 100);
    const wt = mk("wt", "/repo/.worktrees/feat-x", 200, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const { pinned, unpinned } = groupSessionsByDirectory([main, wt], undefined, [], "linux");
    expect(pinned).toEqual([]);
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0]!.cwd).toBe("/repo");
  });

  it("explicit pin of worktree path renders worktree as its own group", () => {
    const main = mk("main", "/repo", 100);
    const wt = mk("wt", "/repo/.worktrees/feat-x", 200, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const { pinned } = groupSessionsByDirectory(
      [main, wt],
      undefined,
      ["/repo", "/repo/.worktrees/feat-x"],
      "linux",
    );
    expect(pinned).toHaveLength(2);
    const repoGroup = pinned.find((g) => g.cwd === "/repo");
    const wtGroup = pinned.find((g) => g.cwd === "/repo/.worktrees/feat-x");
    expect(repoGroup?.sessions.map((s) => s.id)).toEqual(["main"]);
    expect(wtGroup?.sessions.map((s) => s.id)).toEqual(["wt"]);
  });

  it("worktree sessions ordered by flat startedAt desc, NOT clustered", () => {
    // No order map → pure startedAt desc; worktree siblings interleave with
    // the main checkout freely (no cluster adjacency).
    const a = mk("a", "/repo", 500); // main
    const b = mk("b", "/repo/.worktrees/feat-y", 400, {
      gitWorktree: { mainPath: "/repo", name: "feat-y" },
    });
    const c = mk("c", "/repo/.worktrees/feat-x", 300, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const d = mk("d", "/repo/.worktrees/feat-y", 200, {
      gitWorktree: { mainPath: "/repo", name: "feat-y" },
    });
    const e = mk("e", "/repo/.worktrees/feat-x", 100, {
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    });
    const { pinned } = groupSessionsByDirectory([a, b, c, d, e], undefined, ["/repo"], "linux");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.sessions.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("a moved worktree session sorts ahead of the main checkout (flat order wins)", () => {
    const a = mk("a", "/repo", 100); // main
    const b = mk("b", "/repo/.worktrees/feat", 200, {
      gitWorktree: { mainPath: "/repo", name: "feat" },
    });
    const c = mk("c", "/repo/.worktrees/feat", 300, {
      gitWorktree: { mainPath: "/repo", name: "feat" },
    });
    // Server surfaces worktree session c at the front, ahead of main `a`.
    const orderMap = new Map<string, string[]>([["/repo", ["c", "b", "a"]]]);
    const { pinned } = groupSessionsByDirectory([a, b, c], orderMap, ["/repo"], "linux");
    // Flat order honored verbatim — no cluster rule pulls `a` (main) first.
    expect(pinned[0]!.sessions.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("backward-compat: session without gitWorktree behaves as plain checkout", () => {
    const s = mk("s", "/some/path", 100);
    const { unpinned } = groupSessionsByDirectory([s], undefined, [], "linux");
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0]!.cwd).toBe("/some/path");
  });
});

// Cold-start parity: a session restored from .meta.json (status "ended", no
// live bridge) carries the persisted parentage that the scanner reconstructs.
// Grouping must collapse it under its parent exactly as a live session would,
// and — because it lands in the parent group's `sessions` — its attachedProposal
// re-links to the parent repo's OpenSpec change row.
// See change: fix-cold-start-worktree-session-grouping.
describe("cold-start worktree parity + OpenSpec linked-session", () => {
  it("restored ended worktree session collapses under pinned parent", () => {
    const main = { ...mk("main", "/repo", 100), status: "ended" } as DashboardSession;
    const wt = {
      ...mk("wt", "/repo/.worktrees/feat-x", 200, {
        gitWorktree: { mainPath: "/repo", name: "feat-x" },
      }),
      status: "ended",
    } as DashboardSession;
    const { pinned } = groupSessionsByDirectory([main, wt], undefined, ["/repo"], "linux");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.cwd).toBe("/repo");
    expect(pinned[0]!.sessions.map((s) => s.id).sort()).toEqual(["main", "wt"]);
  });

  it("attachedProposal of a restored worktree session links under the parent group", () => {
    const wt = {
      ...mk("wt", "/repo/.worktrees/feat-x", 200, {
        gitWorktree: { mainPath: "/repo", name: "feat-x" },
      }),
      status: "ended",
      attachedProposal: "add-foo",
    } as DashboardSession;
    const { pinned } = groupSessionsByDirectory([wt], undefined, ["/repo"], "linux");
    const repoGroup = pinned.find((g) => g.cwd === "/repo")!;
    // Mirror FolderOpenSpecSection's linkedSessions filter (it runs over
    // group.sessions for the parent repo's OpenSpec data).
    const linked = repoGroup.sessions.filter((s) => s.attachedProposal === "add-foo");
    expect(linked.map((s) => s.id)).toEqual(["wt"]);
  });
});
