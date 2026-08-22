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
import { describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import {
  computeFolderGroupKeys,
  createFolderHeadPoll,
  type FolderGroupSession,
} from "../git-worktree/folder-head-poll.js";
import { createFolderHeadWatcher } from "../git-worktree/folder-head-watcher.js";
import type { HeadInfo } from "../git-worktree/git-operations.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";

vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: async () => ({
    local: { extensions: [], skills: [], prompts: [] },
    global: { extensions: [], skills: [], prompts: [] },
    packages: [],
  }),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: () => [] }));

function active(cwd: string): FolderGroupSession {
  return { cwd, status: "active", gitWorktree: undefined } as FolderGroupSession;
}

/**
 * Periodic-tick equivalent: the key-set recompute now lives in
 * `directory-service` (single recompute path).
 * See change: fix-folder-header-worktree-branch-leak.
 */
function tick(
  poll: { refreshMany(cwds: ReadonlyArray<string>): Promise<void> },
  sessions: ReadonlyArray<FolderGroupSession>,
  pinned: ReadonlyArray<string>,
): Promise<void> {
  return poll.refreshMany(computeFolderGroupKeys(sessions, pinned));
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
    await tick(poll, [active("/repo")], []);
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

    await tick(poll, [active("/repo")], []);
    // External checkout — no watcher to fire it.
    branch = "develop";
    await tick(poll, [active("/repo")], []); // next tick converges
    expect(calls.map((c) => c.branch)).toEqual(["os/foo", "develop"]);
  });
});

// ── refresh-on-entry (fix-folder-header-worktree-branch-leak) ───────────────
//
// A folder key entering the OBSERVED set must be read without waiting a full
// poll interval (default 60s). Entry is judged against the previously computed
// key set — NOT against "never seen before" — because a folder whose sessions
// have all ended is absent from the poll set while remaining a known cwd.
// The previous-set bookkeeping lives in `directory-service` (single recompute
// path), so these exercise the real service rather than the poll object.

describe("folder-head refresh on entry", () => {
  /** Long poll interval: nothing here may be explained by a periodic tick. */
  const NO_TICK_SECONDS = 3600;
  const DEBOUNCE_SETTLE_MS = 700; // > the 500ms entry debounce

  function stubWatcher() {
    const attached = new Set<string>();
    return {
      attach: (cwd: string) => { const had = attached.has(cwd); attached.add(cwd); return !had; },
      detach: (cwd: string) => { attached.delete(cwd); },
      detachAll: () => { attached.clear(); },
      size: () => attached.size,
      set onChange(_cb: (cwd: string) => void) { /* unused */ },
    };
  }

  interface Harness {
    service: DirectoryService;
    /** Every `git_head_update` broadcast since start, in order. */
    broadcasts: BrowserGitHeadUpdateMessage[];
    /** Mutable session list backing `sessionManager.listAll()`. */
    sessions: FolderGroupSession[];
    /** Mutable pinned-directory list. */
    pinned: string[];
    /** Mutable cwd → branch the stub `readHead` reports. */
    heads: Map<string, string>;
  }

  function harness(initial: {
    sessions?: FolderGroupSession[];
    pinned?: string[];
    heads?: Record<string, string>;
    pollIntervalSeconds?: number;
  } = {}): Harness {
    const sessions = initial.sessions ?? [];
    const pinned = initial.pinned ?? [];
    const heads = new Map(Object.entries(initial.heads ?? {}));
    const broadcasts: BrowserGitHeadUpdateMessage[] = [];
    const service = createDirectoryService(
      {
        getPinnedDirectories: () => pinned,
        getSessionOrder: () => ({}),
        getFavoriteModels: () => [],
        getWorkspaces: () => [],
        flush: () => {},
        dispose: () => {},
      } as unknown as PreferencesStore,
      {
        get: () => undefined,
        listActive: () => sessions,
        listAll: () => sessions,
      } as unknown as SessionManager,
      {
        pollIntervalSeconds: initial.pollIntervalSeconds ?? NO_TICK_SECONDS,
        jitterSeconds: 0,
        useWorker: false,
        enabled: false,
      },
      {
        changeWatcher: stubWatcher() as any,
        folderHeadWatcher: stubWatcher() as any,
        folderHeadReadHead: async (cwd: string): Promise<HeadInfo> => ({
          branch: heads.get(cwd) ?? null,
          detached: false,
          sha: null,
        }),
      },
    );
    service.startPolling(() => {}, (msg) => broadcasts.push(msg));
    return { service, broadcasts, sessions, pinned, heads };
  }

  /** Wait for the initial tick to settle so the "previous set" is established. */
  const settle = () => new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));

  it("refreshes a key absent from the previous set, before any tick (#E8)", async () => {
    const h = harness({ sessions: [active("/a")], heads: { "/a": "develop", "/b": "main" } });
    await settle();
    expect(h.broadcasts).toEqual([{ type: "git_head_update", cwd: "/a", branch: "develop" }]);

    h.sessions.push(active("/b")); // a session registers resolving to /b
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toContainEqual({ type: "git_head_update", cwd: "/b", branch: "main" });
    h.service.stopPolling();
  });

  it("does not re-broadcast a key already in the previous set (#E9)", async () => {
    const h = harness({ sessions: [active("/a")], heads: { "/a": "develop" } });
    await settle();
    expect(h.broadcasts).toHaveLength(1);

    h.sessions.push(active("/a")); // second session in the SAME folder
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toHaveLength(1);
    h.service.stopPolling();
  });

  it("registration into an ended-only folder counts as entry (#E10)", async () => {
    // `/a` is a KNOWN cwd (an ended session carries it) so `isNewCwd` is false,
    // but it is absent from the key set because the poll skips ended sessions.
    const ended: FolderGroupSession = { cwd: "/a", status: "ended", gitWorktree: undefined } as FolderGroupSession;
    const h = harness({ sessions: [ended], heads: { "/a": "develop" } });
    await settle();
    expect(h.broadcasts).toHaveLength(0); // ended-only → not in the set

    h.sessions.push(active("/a")); // a NEW session registers at /a
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toEqual([{ type: "git_head_update", cwd: "/a", branch: "develop" }]);
    h.service.stopPolling();
  });

  it("pinning a session-less directory refreshes its key (#E11)", async () => {
    const h = harness({ sessions: [active("/a")], heads: { "/a": "develop", "/c": "main" } });
    await settle();

    h.pinned.push("/c"); // pin a directory with zero sessions
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toContainEqual({ type: "git_head_update", cwd: "/c", branch: "main" });
    h.service.stopPolling();
  });

  it("a worktree parent key entering on re-key is refreshed (#E12)", async () => {
    // Registered without `gitWorktree`, so the session groups under its own
    // cwd and `/repo` is NOT in the set. `git_info_update` then supplies
    // `mainPath` and the resolved key becomes `/repo`.
    const wt: FolderGroupSession = {
      cwd: "/repo/.worktrees/os-foo",
      status: "active",
      gitWorktree: undefined,
    } as FolderGroupSession;
    const h = harness({ sessions: [wt], heads: { "/repo": "develop", "/repo/.worktrees/os-foo": "os/foo" } });
    await settle();
    expect(h.broadcasts.map((b) => b.cwd)).not.toContain("/repo");

    (wt as any).gitWorktree = { mainPath: "/repo" };
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toContainEqual({ type: "git_head_update", cwd: "/repo", branch: "develop" });
    h.service.stopPolling();
  });

  it("an OBSERVED re-entry is re-read rather than served stale (#E13)", async () => {
    const a = active("/a");
    const h = harness({ sessions: [a], heads: { "/a": "develop" } });
    await settle();
    expect(h.broadcasts).toEqual([{ type: "git_head_update", cwd: "/a", branch: "develop" }]);

    // Sessions end and a recomputation OBSERVES the departure.
    (a as any).status = "ended";
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    // HEAD moves while `/a` is unobserved, then a new session re-enters it.
    h.heads.set("/a", "feature");
    h.sessions.push(active("/a"));
    h.service.refreshFolderHeadsForEnteringKeys();
    await settle();

    expect(h.broadcasts).toContainEqual({ type: "git_head_update", cwd: "/a", branch: "feature" });
    h.service.stopPolling();
  });

  it("an UNOBSERVED leave/re-enter converges on the next cycle (#E14)", async () => {
    // Real periodic cycles here — the assertion IS "the next cycle converges",
    // so staleness must be shown bounded by one interval, never permanent.
    const a = active("/a");
    const h = harness({ sessions: [a], heads: { "/a": "develop" }, pollIntervalSeconds: 0.1 });
    // POLL for the first broadcast rather than sleeping a fixed 50ms: the
    // initial tick in `startPolling` is fire-and-forget on real timers, so a
    // loaded runner can leave `broadcasts` empty at 50ms. Waiting longer cannot
    // break the assertion — `refreshOne`'s dedup suppresses a second `develop`.
    await vi.waitFor(() => {
      expect(h.broadcasts).toEqual([{ type: "git_head_update", cwd: "/a", branch: "develop" }]);
    }, { timeout: 5_000, interval: 20 });

    // `/a` leaves and re-enters without any recomputation observing the
    // departure, so the entry trigger may legitimately skip it — but the
    // periodic cycle re-reads every key in the set and converges.
    (a as any).status = "ended";
    h.sessions.push(active("/a"));
    h.heads.set("/a", "feature");
    h.service.refreshFolderHeadsForEnteringKeys();

    await new Promise((r) => setTimeout(r, 900)); // several 100ms cycles
    expect(h.broadcasts).toContainEqual({ type: "git_head_update", cwd: "/a", branch: "feature" });
    h.service.stopPolling();
  });

  it("the snapshot accessor yields empty after shutdown (#X3)", async () => {
    const h = harness({ sessions: [active("/a")], heads: { "/a": "develop" } });
    await settle();
    expect(h.service.folderHeadSnapshot()).toEqual([{ cwd: "/a", branch: "develop" }]);

    // `folderHeadPoll` is nulled on stop — the accessor must not dereference it.
    h.service.stopPolling();
    expect(h.service.folderHeadSnapshot()).toEqual([]);
    // And an entry trigger after shutdown is inert, not a TypeError.
    expect(() => h.service.refreshFolderHeadsForEnteringKeys()).not.toThrow();
  });
});
