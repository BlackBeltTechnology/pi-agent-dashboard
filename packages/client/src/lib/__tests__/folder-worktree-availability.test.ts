/**
 * Folder-level worktree availability resolution — the single rule every
 * folder surface (sidebar `+ New Worktree`, `Manage worktrees`, board
 * `New worktree`, new-proposal dialog) asks.
 *
 * Pins design D2/D3/D5: `folderGitMap` is POSITIVE evidence only (`null` =
 * unknown, never "non-git"), the preference gate outranks git state, an
 * unloaded preference reads as ON, and folder identity goes through the
 * shared `pathKey` normalization.
 *
 * See change: fix-openspec-board-worktree-button-gating.
 */

import { pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import { describe, expect, it } from "vitest";
import { resolveWorktreeAvailability } from "../git/folder-worktree-availability.js";

describe("resolveWorktreeAvailability", () => {
  // E1
  it("treats a non-null folder HEAD as positive evidence, outranking a stale session flag", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [{ cwd: "/repo", isGitRepo: false }],
        folderGitMap: new Map([["/repo", "develop"]]),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });

  // E2
  it("does not disable on an absent HEAD report (null = unknown)", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [{ cwd: "/repo", isGitRepo: undefined }],
        folderGitMap: new Map([["/repo", null]]),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });

  // E3
  it("reports not-a-git-repo when a session confirms non-git and HEAD is unknown", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [{ cwd: "/repo", isGitRepo: false }],
        folderGitMap: new Map([["/repo", null]]),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: false, reason: "not-a-git-repo" });
  });

  // E4
  it("fails open when git state is unknown", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [
          { cwd: "/repo", isGitRepo: undefined },
          { cwd: "/repo", isGitRepo: true },
        ],
        folderGitMap: new Map(),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });

  // E5
  it("fails open for a folder with zero sessions", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [],
        folderGitMap: new Map(),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });

  // E6
  it("reports not-a-git-repo from a session probe alone", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [{ cwd: "/repo", isGitRepo: false }],
        folderGitMap: new Map(),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: false, reason: "not-a-git-repo" });
  });

  // E7
  it("lets the preference gate outrank a confirmed git repo", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [],
        folderGitMap: new Map([["/repo", "develop"]]),
        gitWorktreeEnabled: false,
      }),
    ).toEqual({ available: false, reason: "worktrees-disabled" });
  });

  // E8
  it("reports the preference reason when both causes apply", () => {
    const result = resolveWorktreeAvailability({
      cwd: "/repo",
      sessions: [{ cwd: "/repo", isGitRepo: false }],
      folderGitMap: new Map(),
      gitWorktreeEnabled: false,
    });
    expect(result.reason).toBe("worktrees-disabled");
    expect(result.available).toBe(false);
  });

  // E9
  it("reads an unloaded preference as enabled", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [],
        folderGitMap: new Map(),
        gitWorktreeEnabled: undefined,
      }),
    ).toEqual({ available: true });
  });

  // E10 — asserted on the NEGATIVE branch on purpose: `{available:true}` is
  // also what fail-open returns, so a `true` expectation here would still pass
  // with normalization deleted. Only the session match can produce
  // `not-a-git-repo`, and it produces it ONLY if `pathKey` folds the trailing
  // slash + darwin case difference.
  it("resolves folder and session paths through pathKey normalization", () => {
    const key = pathKey("/Users/x/Repo", "darwin");
    expect(key).not.toBe("/Users/x/Repo/");
    expect(
      resolveWorktreeAvailability({
        cwd: "/Users/x/Repo/",
        sessions: [{ cwd: "/users/x/repo", isGitRepo: false }],
        folderGitMap: new Map([[key, null]]),
        gitWorktreeEnabled: true,
        platform: "darwin",
      }),
    ).toEqual({ available: false, reason: "not-a-git-repo" });

    // The positive-HEAD lookup normalizes the same way: the map key is the
    // folded form, the query is the raw display path.
    expect(
      resolveWorktreeAvailability({
        cwd: "/Users/x/Repo/",
        sessions: [{ cwd: "/users/x/repo", isGitRepo: false }],
        folderGitMap: new Map([[key, "develop"]]),
        gitWorktreeEnabled: true,
        platform: "darwin",
      }),
    ).toEqual({ available: true });
  });

  // E11
  it("is independent of session liveness", () => {
    const input = (status: "ended" | "active") => ({
      cwd: "/repo",
      sessions: [
        { cwd: "/repo", status, gitBranch: undefined, isGitRepo: true },
        { cwd: "/repo/.worktrees/x", status: "active" as const, isGitRepo: true },
      ],
      folderGitMap: new Map<string, string | null>(),
      gitWorktreeEnabled: true,
    });
    expect(resolveWorktreeAvailability(input("ended"))).toEqual({ available: true });
    expect(resolveWorktreeAvailability(input("ended"))).toEqual(resolveWorktreeAvailability(input("active")));
  });

  // X1
  it("never turns a failed HEAD probe into not-a-git-repo", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [],
        folderGitMap: new Map([["/repo", null]]),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });

  // X2
  it("cannot be pinned off by a stale negative HEAD cache", () => {
    expect(
      resolveWorktreeAvailability({
        cwd: "/repo",
        sessions: [{ cwd: "/repo", isGitRepo: true }],
        folderGitMap: new Map([["/repo", null]]),
        gitWorktreeEnabled: true,
      }),
    ).toEqual({ available: true });
  });
});
