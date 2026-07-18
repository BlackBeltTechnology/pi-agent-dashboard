/**
 * Tests for the pure `activeSessionsUnder` / `isPathInside` helpers in
 * `active-sessions-in-cwd.ts`. Pinned shape: exact match, descendant
 * match, sibling exclusion, ended exclusion, empty list.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { describe, it, expect } from "vitest";
import {
  activeSessionsUnder,
  isPathInside,
  sessionsUnder,
} from "../session/active-sessions-in-cwd.js";
import type { DashboardSession, SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function s(id: string, cwd: string, status: SessionStatus = "active"): Pick<DashboardSession, "id" | "cwd" | "status"> {
  return { id, cwd, status };
}

describe("isPathInside", () => {
  it("exact match on linux", () => {
    expect(isPathInside("/repo/.worktrees/x", "/repo/.worktrees/x", "linux")).toBe(true);
  });
  it("descendant match on linux", () => {
    expect(isPathInside("/repo/.worktrees/x", "/repo/.worktrees/x/sub", "linux")).toBe(true);
  });
  it("sibling NOT inside", () => {
    expect(isPathInside("/repo/.worktrees/x", "/repo/.worktrees/y", "linux")).toBe(false);
  });
  it("prefix-but-not-boundary NOT inside (foo vs foobar)", () => {
    expect(isPathInside("/repo/foo", "/repo/foobar", "linux")).toBe(false);
  });
  it("case-insensitive on darwin", () => {
    expect(isPathInside("/Repo/X", "/repo/x/sub", "darwin")).toBe(true);
  });
  it("case-sensitive on linux", () => {
    expect(isPathInside("/Repo/X", "/repo/x", "linux")).toBe(false);
  });
  it("windows separators match", () => {
    expect(isPathInside("C:\\repo\\.worktrees\\x", "C:\\repo\\.worktrees\\x\\sub", "win32")).toBe(true);
  });
  it("windows case-insensitive", () => {
    expect(isPathInside("C:\\REPO\\X", "c:\\repo\\x", "win32")).toBe(true);
  });
  it("empty inputs return false", () => {
    expect(isPathInside("", "/x", "linux")).toBe(false);
    expect(isPathInside("/x", "", "linux")).toBe(false);
  });
});

describe("activeSessionsUnder", () => {
  it("exact-match returns the session id", () => {
    const result = activeSessionsUnder("/repo/.worktrees/x", [s("a", "/repo/.worktrees/x")], "linux");
    expect(result).toEqual(["a"]);
  });
  it("descendant match included", () => {
    const result = activeSessionsUnder(
      "/repo/.worktrees/x",
      [s("a", "/repo/.worktrees/x/sub")],
      "linux",
    );
    expect(result).toEqual(["a"]);
  });
  it("sibling excluded", () => {
    const result = activeSessionsUnder(
      "/repo/.worktrees/x",
      [s("a", "/repo/.worktrees/y")],
      "linux",
    );
    expect(result).toEqual([]);
  });
  it("ended sessions excluded", () => {
    const result = activeSessionsUnder(
      "/repo/.worktrees/x",
      [s("a", "/repo/.worktrees/x", "ended"), s("b", "/repo/.worktrees/x", "active")],
      "linux",
    );
    expect(result).toEqual(["b"]);
  });
  it("empty list returns []", () => {
    expect(activeSessionsUnder("/repo/.worktrees/x", [], "linux")).toEqual([]);
  });
  it("empty path returns []", () => {
    expect(activeSessionsUnder("", [s("a", "/x")], "linux")).toEqual([]);
  });
});

describe("sessionsUnder", () => {
  it("includes ended sessions", () => {
    const result = sessionsUnder(
      "/repo/.worktrees/x",
      [s("a", "/repo/.worktrees/x", "ended"), s("b", "/repo/.worktrees/y", "active")],
      "linux",
    );
    expect(result).toEqual(["a"]);
  });
});
