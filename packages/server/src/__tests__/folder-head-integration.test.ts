/**
 * Integration: folder-HEAD watcher trigger vs poll fallback.
 *
 * Verifies the two convergence paths share one diff/broadcast path:
 *   - watcher: a HEAD event triggers `refreshOne` → broadcast WITHOUT a poll tick.
 *   - poll fallback: with the watcher unavailable, the periodic `poll`
 *     converges on the next cycle.
 *
 * See change: refresh-folder-header-branch.
 */

import type { BrowserGitHeadUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it } from "vitest";
import {
  createFolderHeadPoll,
  type FolderGroupSession,
} from "../git-worktree/folder-head-poll.js";
import { createFolderHeadWatcher } from "../git-worktree/folder-head-watcher.js";
import type { HeadInfo } from "../git-worktree/git-operations.js";

function active(cwd: string): FolderGroupSession {
  return { cwd, status: "active", gitWorktree: undefined } as FolderGroupSession;
}

describe("folder-head watcher trigger + poll fallback", () => {
  it("watcher trigger broadcasts via the shared diff path without a poll tick", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let branch = "os/foo";
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: (): HeadInfo => ({ branch, detached: false, sha: "abc1234" }),
    });

    // The watcher's onChange fans into the poll's per-cwd refresh (single
    // broadcast path). Inject a stub gitdir so attach succeeds without fs.
    const watcher = createFolderHeadWatcher({
      onChange: (cwd) => poll.refreshOne(cwd),
      resolveGitDir: () => "/tmp/does-not-matter",
      logger: () => {},
    });

    // Seed the cache via one poll so the next change is a real diff.
    await poll.poll([active("/repo")], []);
    expect(calls).toEqual([{ type: "git_head_update", cwd: "/repo", branch: "os/foo" }]);

    // External checkout: HEAD now develop. Simulate the watcher firing
    // (no poll tick in between) → broadcast happens immediately.
    branch = "develop";
    await poll.refreshOne("/repo"); // what the watcher onChange invokes on a HEAD event
    expect(calls).toEqual([
      { type: "git_head_update", cwd: "/repo", branch: "os/foo" },
      { type: "git_head_update", cwd: "/repo", branch: "develop" },
    ]);

    // The watcher trigger did NOT bypass the diff cache: refreshing again with
    // an unchanged HEAD suppresses the broadcast.
    await poll.refreshOne("/repo");
    expect(calls.length).toBe(2);
    watcher.detachAll();
  });

  it("poll fallback converges when the watcher is unavailable", async () => {
    const calls: BrowserGitHeadUpdateMessage[] = [];
    let branch = "os/foo";
    const poll = createFolderHeadPoll({
      broadcast: (m) => calls.push(m),
      readHead: (): HeadInfo => ({ branch, detached: false, sha: "abc1234" }),
    });
    // Watcher attach always fails (non-git resolution) → poll-only.
    const watcher = createFolderHeadWatcher({
      onChange: (cwd) => poll.refreshOne(cwd),
      resolveGitDir: () => null,
      logger: () => {},
    });
    expect(watcher.attach("/repo")).toBe(false);

    await poll.poll([active("/repo")], []);
    // External checkout — no watcher to fire it.
    branch = "develop";
    await poll.poll([active("/repo")], []); // next tick converges
    expect(calls.map((c) => c.branch)).toEqual(["os/foo", "develop"]);
  });
});
