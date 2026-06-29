/**
 * Unit tests for the folder-HEAD poll: group-key resolution + diff/broadcast.
 * See change: refresh-folder-header-branch.
 */
import { describe, it, expect, vi } from "vitest";
import {
  computeFolderGroupKeys,
  createFolderHeadPoll,
  deriveDisplayBranch,
  type FolderGroupSession,
} from "../folder-head-poll.js";
import type { HeadInfo } from "../git-operations.js";
import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function session(over: Partial<FolderGroupSession> & { cwd: string }): FolderGroupSession {
  return { status: "active", gitWorktree: undefined, ...over } as FolderGroupSession;
}

function onBranch(branch: string): HeadInfo {
  return { branch, detached: false, sha: "abc1234", hasSubmodules: false };
}

describe("computeFolderGroupKeys", () => {
  it("includes gitWorktree.mainPath for a non-pinned worktree session", () => {
    const sessions = [
      session({
        cwd: "/repo/.worktrees/feature",
        gitWorktree: { mainPath: "/repo", base: undefined } as any,
      }),
    ];
    const keys = computeFolderGroupKeys(sessions, [], "linux");
    expect(keys).toContain("/repo");
    expect(keys).not.toContain("/repo/.worktrees/feature");
  });

  it("excludes ended sessions", () => {
    const sessions = [
      session({ cwd: "/a", status: "ended" }),
      session({ cwd: "/b", status: "active" }),
    ];
    const keys = computeFolderGroupKeys(sessions, [], "linux");
    expect(keys).toEqual(["/b"]);
  });

  it("honors pin-wins: a pinned worktree cwd groups under itself", () => {
    const sessions = [
      session({
        cwd: "/repo/.worktrees/feature",
        gitWorktree: { mainPath: "/repo", base: undefined } as any,
      }),
    ];
    const keys = computeFolderGroupKeys(sessions, ["/repo/.worktrees/feature"], "linux");
    expect(keys).toContain("/repo/.worktrees/feature");
    expect(keys).not.toContain("/repo");
  });

  it("includes pinned directories with no sessions", () => {
    const keys = computeFolderGroupKeys([], ["/pinned"], "linux");
    expect(keys).toEqual(["/pinned"]);
  });

  it("de-duplicates by path key", () => {
    const sessions = [
      session({ cwd: "/x" }),
      session({ cwd: "/x" }),
    ];
    const keys = computeFolderGroupKeys(sessions, ["/x"], "linux");
    expect(keys).toEqual(["/x"]);
  });
});

describe("deriveDisplayBranch", () => {
  it("returns the branch name when on a branch", () => {
    expect(deriveDisplayBranch(onBranch("develop"))).toBe("develop");
  });
  it("returns the short SHA when detached", () => {
    expect(deriveDisplayBranch({ branch: null, detached: true, sha: "deadbee" })).toBe("deadbee");
  });
  it("returns null for a non-git / empty repo", () => {
    expect(deriveDisplayBranch({ branch: null, detached: false, sha: null })).toBeNull();
  });
});

describe("createFolderHeadPoll", () => {
  it("broadcasts once on first observation, suppresses unchanged", () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const readHead = vi.fn(() => onBranch("develop"));
    const poll = createFolderHeadPoll({ broadcast: (m) => calls.push(m), readHead });

    poll.poll([session({ cwd: "/repo" })], []);
    poll.poll([session({ cwd: "/repo" })], []);

    expect(calls).toEqual([{ type: "git_head_update", cwd: "/repo", branch: "develop" }]);
    expect(readHead).toHaveBeenCalledTimes(2);
  });

  it("broadcasts again when HEAD changes", () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let branch = "os/foo";
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => onBranch(branch),
    });
    poll.poll([session({ cwd: "/repo" })], []);
    branch = "develop";
    poll.poll([session({ cwd: "/repo" })], []);

    expect(calls.map((c) => c.branch)).toEqual(["os/foo", "develop"]);
  });

  it("missing/non-git cwd broadcasts branch:null once", () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => ({ branch: null, detached: false, sha: null }),
    });
    poll.poll([session({ cwd: "/not-git" })], []);
    poll.poll([session({ cwd: "/not-git" })], []);

    expect(calls).toEqual([{ type: "git_head_update", cwd: "/not-git", branch: null }]);
  });

  it("treats a readHead throw as non-git (null), logged", () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const logs: string[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => { throw new Error("boom"); },
      logger: (m) => logs.push(m),
    });
    poll.refreshOne("/x");
    expect(calls).toEqual([{ type: "git_head_update", cwd: "/x", branch: null }]);
    expect(logs.length).toBe(1);
  });
});
