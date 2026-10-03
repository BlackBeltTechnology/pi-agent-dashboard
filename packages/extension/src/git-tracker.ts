/**
 * Per-bridge git state tracker (change: optimize-polling-hot-paths, D4–D6).
 *
 * Owns: the per-cwd static-facts cache, the HEAD-file branch reader, the cached
 * `git status`, the two-lane probe scheduler and the git-dir watcher. The ONE
 * place that decides when git is spawned; everything it spawns is async.
 *
 * Send discipline: a `git_info_update` for branch/status is only ever sent from
 * the probe-result path (one coherent branch + facts + status), the PR-change
 * path (cached state) and the synchronous FIRST evaluation (registration /
 * session or cwd change — branch + worktree, status omitted). The 30 s tick,
 * tool ends and watcher events only REQUEST a probe.
 */

import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { Result } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BridgeContext } from "./bridge-context.js";
import { createGitDirWatcher, type GitDirWatcher, type WatchFn } from "./git-dir-watcher.js";
import {
  createGitProbeScheduler,
  type GitProbeScheduler,
  type ProbeLane,
  type ProbeOutcome,
  type ProbeReason,
} from "./git-probe-scheduler.js";
import { sendGitInfoIfChanged } from "./model-tracker.js";
import { incPollCost, pollCost } from "./poll-cost.js";
import {
  createHeadBranchReader,
  detectBranch,
  GitFactsCache,
  gitInfoFrom,
  type HeadBranchReader,
} from "./vcs-info.js";

/** Tools that cannot dirty the working tree (compared case-insensitively). */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
/** Re-probe static facts on every Nth tick (~5 min at 30 s). */
const FACTS_REPROBE_EVERY_N_TICKS = 10;

type Timer = ReturnType<typeof setTimeout>;

export interface GitTrackerDeps {
  getBc: () => BridgeContext;
  applyBc: (bc: BridgeContext) => void;
  isActive: () => boolean;
  facts?: GitFactsCache;
  statusProbe?: (cwd: string) => Promise<Result<GitStatus>>;
  headReader?: (onResolved: () => void) => HeadBranchReader;
  watch?: WatchFn;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
  log?: (line: string) => void;
}

export interface GitTracker {
  /**
   * Synchronous first evaluation for `cwd` (registration, cwd or session
   * change): caches facts, resolves the branch, attaches the watcher, sends
   * branch + worktree (status omitted) through `bc`, requests a fast probe.
   * Mutates `bc`; the caller applies it.
   */
  evaluateFirst(bc: BridgeContext, cwd: string): void;
  /** The git part of the 30 s tick: cheap checks + one slow-lane request. */
  tick(bc: BridgeContext, cwd: string): void;
  onToolEnd(toolName: string | undefined): void;
  /** `git_info_refresh`: invalidate facts, fast probe. */
  refresh(): void;
  /** Re-send from cached state (PR tuple changed). No git spawn. */
  sendCached(): void;
  dispose(): void;
}

export function createGitTracker(deps: GitTrackerDeps): GitTracker {
  const facts = deps.facts ?? new GitFactsCache();
  const statusProbe = deps.statusProbe ?? ((cwd: string) => git.gitStatusV2Async({ cwd }));
  const log = deps.log ?? ((line: string) => console.error(line));

  let disposed = false;
  let cwd: string | undefined;
  let generation = 0;
  let ticks = 0;
  let branch: string | undefined;
  let status: GitStatus | undefined;
  let reprobing = false;
  let queuedReprobe: { stamp: boolean } | undefined;
  let logged = false;

  const watcher: GitDirWatcher = createGitDirWatcher({
    onEvent: (lane) => requestProbe(lane, "watch"),
    watch: deps.watch,
  });
  const scheduler: GitProbeScheduler = createGitProbeScheduler({
    probe: runProbe,
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  });
  const reader: HeadBranchReader = (deps.headReader ?? ((cb) => createHeadBranchReader(cb)))(() =>
    requestProbe("fast", "watch"),
  );

  function requestProbe(lane: ProbeLane, reason: ProbeReason): void {
    if (disposed || !deps.isActive() || !cwd) return;
    scheduler.request(lane, reason);
  }

  function attachWatcher(): void {
    const f = cwd ? facts.get(cwd) : undefined;
    const roots = f?.roots;
    const ok = f?.gitDir ? watcher.attach(f.gitDir, roots?.commonDir) : (watcher.detach(), false);
    pollCost.pollGitWatchersAttached = ok ? 1 : 0;
  }

  /** Build + diff + send from cached state. Returns false when nothing to send. */
  function sendFrom(bc: BridgeContext): void {
    const f = cwd ? facts.get(cwd) : undefined;
    if (!cwd || !branch || !f) return;
    sendGitInfoIfChanged(bc, { info: gitInfoFrom(branch, f), status });
  }

  function sendCachedAsync(): void {
    if (disposed || !deps.isActive()) return;
    const bc = deps.getBc();
    sendFrom(bc);
    deps.applyBc(bc);
  }

  function observePr(bc: BridgeContext): void {
    if (cwd && branch) bc.prStatus?.observe({ sessionId: bc.sessionId, cwd, branch });
  }

  async function runProbe(info: { lane: ProbeLane; reason: ProbeReason }): Promise<ProbeOutcome> {
    if (disposed || !deps.isActive() || !cwd) return;
    const probeCwd = cwd;
    const gen = generation;
    const gitDir = facts.get(probeCwd)?.gitDir;
    const key = { tick: "pollGitProbesTick", tool: "pollGitProbesTool", watch: "pollGitProbesWatch", refresh: "pollGitProbesRefresh" } as const;
    incPollCost(key[info.reason]);
    incPollCost("pollGitSpawns");
    const before = reader.read(probeCwd, gitDir);
    const t0 = Date.now();
    let res: Result<GitStatus>;
    try {
      res = await statusProbe(probeCwd);
    } catch (err) {
      res = { ok: false, error: { kind: "spawn-error", message: String(err) } } as unknown as Result<GitStatus>;
    }
    incPollCost("pollGitMs", Date.now() - t0);
    if (disposed || !deps.isActive() || gen !== generation) return "ok"; // stale cwd/session: discard
    const after = reader.read(probeCwd, facts.get(probeCwd)?.gitDir);
    if (before !== after) return "discard"; // HEAD moved mid-probe → one more probe
    if (after) branch = after;
    status = res.ok ? res.value : undefined;
    const bc = deps.getBc();
    observePr(bc); // also on a failed status probe — PR refresh must not depend on it
    sendFrom(bc);
    deps.applyBc(bc);
    return "ok";
  }

  /**
   * Re-probe the static facts asynchronously. A request that arrives while one
   * is in flight is NOT dropped: it sets `reprobeAgain` and exactly one more
   * probe runs after the first settles (the first may have read stale state).
   * The watcher is re-attached after any probe the `.git` stamp triggered, even
   * when the facts compare equal — a git dir replaced at the same path leaves a
   * dead watch on the old inode.
   */
  async function reprobeFacts(forCwd: string, stampTriggered = false): Promise<void> {
    if (disposed) return;
    if (reprobing) {
      queuedReprobe = { stamp: (queuedReprobe?.stamp ?? false) || stampTriggered };
      return;
    }
    reprobing = true;
    let next: { cwd: string; stamp: boolean } | undefined = { cwd: forCwd, stamp: stampTriggered };
    try {
      while (next && !disposed) {
        queuedReprobe = undefined;
        const applied = await probeFactsOnce(next.cwd, next.stamp);
        next = followUpReprobe(next.cwd, applied);
      }
    } catch (err) {
      if (!logged) {
        logged = true;
        log(`[dashboard] git facts re-probe failed: ${String(err)}`);
      }
    } finally {
      reprobing = false;
      queuedReprobe = undefined;
    }
  }

  /**
   * The follow-up for a request that arrived mid-flight, aimed at the CURRENT
   * cwd (a rejected stale probe may belong to a previous session). Nothing is
   * queued, or a rejected probe with no queued request, ends the loop.
   */
  function followUpReprobe(probedCwd: string, applied: boolean): { cwd: string; stamp: boolean } | undefined {
    const queued = queuedReprobe;
    if (!queued || (!applied && !cwd)) return undefined;
    return { cwd: cwd ?? probedCwd, stamp: queued.stamp };
  }

  /** One async facts probe; false when a newer evaluation owns the cache (nothing applied). */
  async function probeFactsOnce(forCwd: string, stampTriggered: boolean): Promise<boolean> {
    const gen = generation;
    const { changed, committed } = await facts.reprobe(forCwd, () => !disposed && gen === generation && deps.isActive());
    if (!committed) return false;
    if (changed || stampTriggered) attachWatcher();
    if (changed) requestProbe("fast", "refresh");
    return true;
  }

  return {
    evaluateFirst(bc, nextCwd) {
      if (disposed) return;
      cwd = nextCwd;
      generation += 1;
      ticks = 0;
      status = undefined;
      reader.reset();
      bc.lastGitBranch = undefined;
      bc.lastGitPrJson = undefined;
      bc.lastGitWorktreeJson = undefined;
      bc.lastGitStatusJson = undefined;
      const f = facts.evaluate(nextCwd);
      // The file read covers the common case; a detached HEAD pays one
      // synchronous CLI read here (first evaluation only).
      branch = reader.read(nextCwd, f.gitDir) ?? detectBranch(nextCwd);
      attachWatcher();
      if (!branch) return; // not a git repo (a later stamp change can promote it)
      observePr(bc);
      sendFrom(bc);
      requestProbe("fast", "refresh");
    },

    tick(bc, tickCwd) {
      if (disposed) return;
      if (tickCwd !== cwd) {
        this.evaluateFirst(bc, tickCwd);
        return;
      }
      ticks += 1;
      const stampChanged = facts.stampChanged(tickCwd);
      if (stampChanged || ticks % FACTS_REPROBE_EVERY_N_TICKS === 0) void reprobeFacts(tickCwd, stampChanged);
      const fresh = reader.read(tickCwd, facts.get(tickCwd)?.gitDir);
      const branchMoved = fresh !== undefined && fresh !== branch;
      // Observe the last SETTLED branch; a moved branch is observed by the
      // probe it triggers, together with its status.
      observePr(bc);
      requestProbe(branchMoved ? "fast" : "slow", "tick");
    },

    onToolEnd(toolName) {
      if (toolName && READ_ONLY_TOOLS.has(toolName.toLowerCase())) return;
      requestProbe("slow", "tool");
    },

    refresh() {
      if (disposed || !cwd) return;
      void reprobeFacts(cwd);
      requestProbe("fast", "refresh");
    },

    sendCached: sendCachedAsync,

    dispose() {
      disposed = true;
      scheduler.dispose();
      watcher.detach();
      pollCost.pollGitWatchersAttached = 0;
    },
  };
}
