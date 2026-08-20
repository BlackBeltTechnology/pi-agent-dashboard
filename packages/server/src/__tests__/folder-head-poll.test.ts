/**
 * Unit tests for the folder-HEAD poll: group-key resolution + diff/broadcast.
 * See change: refresh-folder-header-branch.
 */

import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it, vi } from "vitest";
import {
  computeFolderGroupKeys,
  createFolderHeadPoll,
  deriveDisplayBranch,
  type FolderGroupSession,
} from "../git-worktree/folder-head-poll.js";
import type { HeadInfo } from "../git-worktree/git-operations.js";

function session(over: Partial<FolderGroupSession> & { cwd: string }): FolderGroupSession {
  return { status: "active", gitWorktree: undefined, ...over } as FolderGroupSession;
}

/**
 * Periodic-tick equivalent: the key-set recompute now lives in
 * `directory-service` (single recompute path), so the poll object exposes only
 * the bounded refresh fan-out.
 * See change: fix-folder-header-worktree-branch-leak.
 */
function tick(
  poll: { refreshMany(cwds: ReadonlyArray<string>): Promise<void> },
  sessions: ReadonlyArray<FolderGroupSession>,
  pinned: ReadonlyArray<string>,
): Promise<void> {
  return poll.refreshMany(computeFolderGroupKeys(sessions, pinned));
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
  it("broadcasts once on first observation, suppresses unchanged", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const readHead = vi.fn(() => onBranch("develop"));
    const poll = createFolderHeadPoll({ broadcast: (m) => calls.push(m), readHead });

    await tick(poll, [session({ cwd: "/repo" })], []);
    await tick(poll, [session({ cwd: "/repo" })], []);

    expect(calls).toEqual([{ type: "git_head_update", cwd: "/repo", branch: "develop" }]);
    expect(readHead).toHaveBeenCalledTimes(2);
  });

  it("broadcasts again when HEAD changes (branch switch reflects on next tick)", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let branch = "os/foo";
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => onBranch(branch),
    });
    await tick(poll, [session({ cwd: "/repo" })], []);
    branch = "develop";
    await tick(poll, [session({ cwd: "/repo" })], []);

    expect(calls.map((c) => c.branch)).toEqual(["os/foo", "develop"]);
  });

  it("missing/non-git cwd broadcasts branch:null once", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => ({ branch: null, detached: false, sha: null }),
    });
    await tick(poll, [session({ cwd: "/not-git" })], []);
    await tick(poll, [session({ cwd: "/not-git" })], []);

    expect(calls).toEqual([{ type: "git_head_update", cwd: "/not-git", branch: null }]);
  });

  it("treats a readHead throw as non-git (null), logged", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const logs: string[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: () => { throw new Error("boom"); },
      logger: (m) => logs.push(m),
    });
    await poll.refreshOne("/x");
    expect(calls).toEqual([{ type: "git_head_update", cwd: "/x", branch: null }]);
    expect(logs.length).toBe(1);
  });

  it("awaits an async readHead (default reader is async)", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: async (cwd) => (cwd === "/a" ? onBranch("main") : { branch: null, detached: false, sha: null }),
    });
    await tick(poll, [session({ cwd: "/a" }), session({ cwd: "/b" })], []);
    expect(calls).toContainEqual({ type: "git_head_update", cwd: "/a", branch: "main" });
    expect(calls).toContainEqual({ type: "git_head_update", cwd: "/b", branch: null });
  });

  it("bounds concurrency of HEAD reads to the configured cap", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      concurrency: 2,
      readHead: async (cwd) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return onBranch(`b-${cwd}`);
      },
    });
    const sessions = ["/1", "/2", "/3", "/4", "/5"].map((cwd) => session({ cwd }));
    await tick(poll, sessions, []);
    expect(calls).toHaveLength(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

// ── entry fan-out + snapshot (fix-folder-header-worktree-branch-leak) ────────
//
// `refreshMany` is the SINGLE bounded fan-out shared by the periodic tick and
// the entry refresh; `snapshot` is the pure read the browser connect snapshot
// replays. The key-set recompute itself lives in `directory-service`.

describe("folder-head entry fan-out + snapshot", () => {
  it("retains a cached value for a key that left the set (#E15)", async () => {
    const poll = createFolderHeadPoll({
      broadcast: () => {},
      readHead: async () => onBranch("develop"),
    });
    await tick(poll, [session({ cwd: "/a" })], []);
    expect(poll.snapshot()).toEqual([{ cwd: "/a", branch: "develop" }]);
    // `/a`'s sessions all end → it leaves the recomputed key set.
    await tick(poll, [session({ cwd: "/a", status: "ended" })], []);
    // Cache is NOT evicted: the folder still renders (ended-only groups,
    // workspace folders) and the connect snapshot must still carry it.
    expect(poll.snapshot()).toEqual([{ cwd: "/a", branch: "develop" }]);
  });

  it("snapshot is a pure read — it does not suppress a later broadcast (#E17)", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let branch = "develop";
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: async () => onBranch(branch),
    });
    await tick(poll, [session({ cwd: "/a" })], []);
    const before = JSON.stringify(poll.snapshot());
    poll.snapshot();
    poll.snapshot();
    expect(JSON.stringify(poll.snapshot())).toBe(before);
    branch = "feature";
    await poll.refreshOne("/a");
    expect(calls.map((c) => c.branch)).toEqual(["develop", "feature"]);
  });

  it("entry fan-out honours the concurrency cap (#E20)", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let inFlight = 0;
    let peak = 0;
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      // Default cap is 4 — assert the entry path inherits it, not a burst of 12.
      readHead: async (cwd) => {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return onBranch(`b${cwd}`);
      },
    });
    const entering = Array.from({ length: 12 }, (_, i) => `/e${i}`);
    await poll.refreshMany(entering);
    expect(peak).toBeLessThanOrEqual(4);
    expect(calls).toHaveLength(12);
    expect(poll.size()).toBe(12);
  });

  it("readHead throwing on an entering key degrades to null, once (#X2)", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    const logged: string[] = [];
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      logger: (m) => logged.push(m),
      readHead: () => { throw new Error("boom"); },
    });
    await expect(poll.refreshMany(["/bad"])).resolves.toBeUndefined();
    expect(calls).toEqual([{ type: "git_head_update", cwd: "/bad", branch: null }]);
    // Cached null → a second entry refresh does not re-broadcast.
    await poll.refreshMany(["/bad"]);
    expect(calls).toHaveLength(1);
    expect(logged.join("\n")).toContain("/bad");
  });
});
