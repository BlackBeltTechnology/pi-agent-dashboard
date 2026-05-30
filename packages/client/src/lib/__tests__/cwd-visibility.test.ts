/**
 * Tests for `isVisibleCwd` — the path-key-aware visibility check that
 * gates the off-screen `spawn_error` global-toast fallback.
 *
 * See change: harden-worktree-spawn.
 */
import { describe, it, expect } from "vitest";
import { isVisibleCwd } from "../cwd-visibility.js";

describe("isVisibleCwd", () => {
  it("returns false for empty cwd", () => {
    expect(isVisibleCwd("", { pinnedDirectories: [], workspaces: [], sessions: [] })).toBe(false);
  });

  it("matches an exactly-pinned cwd", () => {
    expect(isVisibleCwd("/repo", {
      pinnedDirectories: ["/repo"], workspaces: [], sessions: [],
    })).toBe(true);
  });

  it("matches a workspace folder", () => {
    expect(isVisibleCwd("/repo", {
      pinnedDirectories: [],
      workspaces: [{ folders: ["/repo"] }],
      sessions: [],
    })).toBe(true);
  });

  it("matches an existing session's cwd", () => {
    expect(isVisibleCwd("/repo", {
      pinnedDirectories: [],
      workspaces: [],
      sessions: [{ cwd: "/repo" }],
    })).toBe(true);
  });

  it("returns false when not pinned, not in any workspace, and no session at that cwd", () => {
    expect(isVisibleCwd("/sibling", {
      pinnedDirectories: ["/repo"],
      workspaces: [{ folders: ["/repo"] }],
      sessions: [{ cwd: "/repo" }],
    })).toBe(false);
  });

  it("trailing-slash drift does NOT cause false negative", () => {
    expect(isVisibleCwd("/repo", {
      pinnedDirectories: ["/repo/"],
      workspaces: [], sessions: [],
      platform: "linux",
    })).toBe(true);
  });

  it("windows case drift does NOT cause false negative", () => {
    expect(isVisibleCwd("c:\\repo", {
      pinnedDirectories: ["C:\\Repo"],
      workspaces: [], sessions: [],
      platform: "win32",
    })).toBe(true);
  });

  it("linux is case-sensitive (different case → not visible)", () => {
    expect(isVisibleCwd("/repo", {
      pinnedDirectories: ["/Repo"],
      workspaces: [], sessions: [],
      platform: "linux",
    })).toBe(false);
  });
});
