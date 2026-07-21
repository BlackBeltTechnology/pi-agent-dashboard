/**
 * Tests for workspace-aware grouping (folder-workspaces).
 * Covers visibility, ordering, and top-level exclusion rules in the
 * `session-grouping` capability spec.
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { groupSessionsByDirectoryWithWorkspaces } from "../session/session-grouping.js";

function mk(id: string, cwd: string, startedAt = 1000): DashboardSession {
  return {
    id, cwd, source: "tui", status: "active", startedAt,
    tokensIn: 0, tokensOut: 0, cost: 0,
  } as DashboardSession;
}

function ws(id: string, name: string, folders: string[], collapsed = false) {
  return { id, name, collapsed, folders };
}

describe("groupSessionsByDirectoryWithWorkspaces", () => {
  it("returns empty workspaces tier and unchanged top-level when no workspaces", () => {
    const sessions = [mk("a", "/x"), mk("b", "/y", 2000)];
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      sessions, [], undefined, [], "linux",
    );
    expect(workspaces).toEqual([]);
    expect(topLevel.map((g) => g.cwd)).toEqual(["/y", "/x"]); // recency
  });

  it("workspace tier contains its folders in workspace `folders[]` order", () => {
    const sessions = [mk("a", "/x"), mk("b", "/y")];
    const { workspaces } = groupSessionsByDirectoryWithWorkspaces(
      sessions, [ws("w1", "client", ["/y", "/x"])], undefined, [], "linux",
    );
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].folders.map((g) => g.cwd)).toEqual(["/y", "/x"]);
  });

  it("synthesizes empty group for a workspace folder with no sessions and no pin", () => {
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      [], [ws("w1", "client", ["/empty"])], undefined, [], "linux",
    );
    expect(workspaces[0].folders).toHaveLength(1);
    expect(workspaces[0].folders[0]).toMatchObject({ cwd: "/empty", sessions: [], pinned: false });
    expect(topLevel).toEqual([]);
  });

  it("workspace folder also in pinnedDirectories renders ONLY in workspace, not top-level", () => {
    const sessions = [mk("a", "/x"), mk("b", "/loose")];
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      sessions, [ws("w1", "client", ["/x"])], undefined, ["/x", "/loose"], "linux",
    );
    expect(workspaces[0].folders.map((g) => g.cwd)).toEqual(["/x"]);
    expect(topLevel.map((g) => g.cwd)).toEqual(["/loose"]);
  });

  it("workspace folder with active sessions: sessions live inside workspace, not at top", () => {
    const sessions = [mk("a", "/proj"), mk("b", "/other", 5000)];
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      sessions, [ws("w1", "p", ["/proj"])], undefined, [], "linux",
    );
    expect(workspaces[0].folders[0].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(topLevel.map((g) => g.cwd)).toEqual(["/other"]);
  });

  it("removed-from-workspace + still pinned → reappears at top level in pin order", () => {
    const sessions = [mk("a", "/x")];
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      sessions,
      [ws("w1", "p", [])], // empty workspace
      undefined,
      ["/x"],
      "linux",
    );
    expect(workspaces[0].folders).toEqual([]);
    expect(topLevel.map((g) => g.cwd)).toEqual(["/x"]);
    expect(topLevel[0].pinned).toBe(true);
  });

  it("removed-from-workspace + not pinned + no sessions → disappears", () => {
    const { workspaces, topLevel } = groupSessionsByDirectoryWithWorkspaces(
      [],
      [ws("w1", "p", [])],
      undefined,
      [],
      "linux",
    );
    expect(workspaces[0].folders).toEqual([]);
    expect(topLevel).toEqual([]);
  });

  it("pin order does not affect intra-workspace order", () => {
    const sessions = [mk("a", "/x"), mk("b", "/y")];
    const { workspaces } = groupSessionsByDirectoryWithWorkspaces(
      sessions,
      [ws("w1", "p", ["/x", "/y"])],
      undefined,
      ["/y", "/x"], // pin order opposite of workspace order
      "linux",
    );
    expect(workspaces[0].folders.map((g) => g.cwd)).toEqual(["/x", "/y"]);
  });

  it("multiple workspaces preserve workspace-array order", () => {
    const { workspaces } = groupSessionsByDirectoryWithWorkspaces(
      [],
      [ws("w1", "a", ["/a"]), ws("w2", "b", ["/b"], true)],
      undefined,
      [],
      "linux",
    );
    expect(workspaces.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(workspaces[1].collapsed).toBe(true);
  });

  it("collapsed flag passes through unchanged from workspace input", () => {
    const { workspaces } = groupSessionsByDirectoryWithWorkspaces(
      [], [ws("w1", "p", [], true)], undefined, [], "linux",
    );
    expect(workspaces[0].collapsed).toBe(true);
  });
});
