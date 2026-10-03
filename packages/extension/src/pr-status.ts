/**
 * Per-bridge PR-status scheduler. Probes `gh pr view` ASYNCHRONOUSLY on its
 * own cadence so the 30 s git-poll tick never blocks on `gh`.
 *
 * Rules (design D5, change: redesign-composer-session-strip):
 * - Cached tuple: each field `undefined` (unknown — omitted on the wire),
 *   `null` (known-absent) or a value. `gitPrCheckedAt` = epoch ms of the last
 *   successful detection that found a PR.
 * - Generation token = sessionId + cwd + branch. A branch-only change resets
 *   the tuple to all-`null` (sent at once, so the old PR never lingers); a
 *   session or cwd change resets it to unknown. Either probes immediately.
 *   A result whose generation no longer matches is discarded.
 * - Probes: first observation (immediately), every ≥ 120 s, on generation
 *   change, and on a forced refresh. At most one probe in flight.
 * - Forced: at most one forced START per 30 s. Requests arriving mid-flight
 *   or inside the window coalesce into ONE pending forced probe (never
 *   dropped) that starts right after the in-flight probe settles, or at the
 *   window edge; `"pr"` wins over `"push"` when coalescing.
 *   `reason:"pr"` retries at +5 s / +15 s while the result is `absent`
 *   (GitHub lag); `reason:"push"` never retries.
 * - Branch-change throttle (change: optimize-polling-hot-paths): generation
 *   changes caused by a branch change (same session + cwd) start a probe at
 *   most once per 30 s — a rebase can move the branch many times a minute and
 *   each would otherwise start a `gh` call. The tuple still resets at once; the
 *   deferred start probes the LATEST branch. Session/cwd changes are never
 *   throttled.
 * - Failure: keep the tuple, back off 120 → 240 → 480 → 600 s (cap); log once
 *   on entering failure and once on recovery.
 * - A probe that has not settled after 20 s is treated as a failure (the
 *   runner also times `gh` out at 20 s; this guards a hung mock / runner).
 */

import type { PrStatusProbe } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { GitPrChecks, GitPrState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const PR_PROBE_INTERVAL_MS = 120_000;
const PR_PROBE_MAX_BACKOFF_MS = 600_000;
const PR_PROBE_TIMEOUT_MS = 20_000;
const PR_FORCED_WINDOW_MS = 30_000;
/** Branch-change generations start a probe at most once per window (latest branch wins). */
const PR_BRANCH_CHANGE_WINDOW_MS = 30_000;
const PR_OPEN_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/** Wire-shaped PR tuple. `undefined` keys are omitted on the wire. */
interface PrTuple {
  gitPrNumber?: number | null;
  gitPrUrl?: string | null;
  gitPrState?: GitPrState | null;
  gitPrDraft?: boolean | null;
  gitPrChecks?: GitPrChecks | null;
  gitPrCheckedAt?: number | null;
}

export interface PrGeneration {
  sessionId: string;
  cwd: string;
  branch: string;
}

type Timer = ReturnType<typeof setTimeout>;

export interface PrStatusSchedulerDeps {
  /** Async, non-throwing probe for `cwd` (prod: `git.prStatusAsync`). */
  probe: (cwd: string) => Promise<PrStatusProbe>;
  /** Called after a settled, non-stale probe changed the tuple, and after a
   *  branch reset. Prod: re-run the git change-detector. */
  onChange: () => void;
  now?: () => number;
  log?: (line: string) => void;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
  /** Owning bridge incarnation still current? `false` → self-dispose (reload). */
  alive?: () => boolean;
}

export interface PrStatusScheduler {
  /** Current tuple (copy). */
  tuple(): PrTuple;
  /** Report the current generation (every git tick / register). Sync: may
   *  reset the tuple and start a probe, never waits for it. */
  observe(gen: PrGeneration): void;
  /** Forced probe after a worktree Push / Open PR (`git_info_refresh`). */
  refresh(reason: "push" | "pr"): void;
  /** `gh` invocations started since creation (debug surface; perf gate). */
  invocations(): number;
  dispose(): void;
}

const UNKNOWN: PrTuple = {};
const ALL_NULL: PrTuple = {
  gitPrNumber: null,
  gitPrUrl: null,
  gitPrState: null,
  gitPrDraft: null,
  gitPrChecks: null,
  gitPrCheckedAt: null,
};

const genKey = (g: PrGeneration) => `${g.sessionId}\u0000${g.cwd}\u0000${g.branch}`;

export function createPrStatusScheduler(deps: PrStatusSchedulerDeps): PrStatusScheduler {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const alive = deps.alive ?? (() => true);

  let gen: PrGeneration | undefined;
  let key: string | undefined;
  let tuple: PrTuple = { ...UNKNOWN };
  let inFlight = false;
  let probeTimeout: Timer | undefined;
  /** Run one plain probe as soon as none is in flight (generation change, pr retry). */
  let pendingStart = false;
  /** A forced request not yet started (in flight, or waiting for the 30 s window). */
  let pendingForce: "push" | "pr" | undefined;
  let windowTimer: Timer | undefined;
  let branchTimer: Timer | undefined;
  let lastBranchStart = Number.NEGATIVE_INFINITY;
  let lastForcedStart = Number.NEGATIVE_INFINITY;
  let failures = 0;
  let failingLogged = false;
  let count = 0;
  let cadenceTimer: Timer | undefined;
  let retryTimers: Timer[] = [];
  let disposed = false;

  const clearRetries = () => {
    for (const t of retryTimers) clearTimer(t);
    retryTimers = [];
  };

  const nextDelay = () =>
    failures === 0 ? PR_PROBE_INTERVAL_MS : Math.min(PR_PROBE_INTERVAL_MS * 2 ** failures, PR_PROBE_MAX_BACKOFF_MS);

  function schedule(delay: number): void {
    if (cadenceTimer) clearTimer(cadenceTimer);
    cadenceTimer = setTimer(() => {
      cadenceTimer = undefined;
      start();
    }, delay);
  }

  /** `false` once the owning bridge incarnation is gone (reload): self-dispose. */
  function usable(): boolean {
    if (disposed) return false;
    if (!alive()) {
      dispose();
      return false;
    }
    return true;
  }

  /** Start one probe unless one is in flight / no generation. Returns whether it started. */
  function start(onSettled?: (r: PrStatusProbe | undefined) => void): boolean {
    if (!usable() || !gen || inFlight) return false;
    const probeCwd = gen.cwd;
    const probeKey = key;
    inFlight = true;
    count += 1;
    let settled = false;
    const finish = (r: PrStatusProbe) => {
      if (settled) return;
      settled = true;
      if (probeTimeout) clearTimer(probeTimeout);
      probeTimeout = undefined;
      inFlight = false;
      if (!usable()) return;
      const stale = probeKey !== key;
      if (!stale) apply(r);
      onSettled?.(stale ? undefined : r);
      pump();
    };
    probeTimeout = setTimer(
      () => finish({ kind: "failure", reason: `timeout after ${PR_PROBE_TIMEOUT_MS}ms` }),
      PR_PROBE_TIMEOUT_MS,
    );
    deps.probe(probeCwd).then(finish, (err: unknown) => finish({ kind: "failure", reason: String(err) }));
    return true;
  }

  function apply(r: PrStatusProbe): void {
    const before = JSON.stringify(tuple);
    if (r.kind === "failure") {
      failures += 1;
      if (!failingLogged) {
        failingLogged = true;
        log(`[dashboard] PR status probe failing (${gen?.cwd}): ${r.reason} — backing off, keeping last value`);
      }
    } else {
      if (failingLogged) log(`[dashboard] PR status probe recovered (${gen?.cwd})`);
      failingLogged = false;
      failures = 0;
      tuple =
        r.kind === "absent"
          ? { ...ALL_NULL }
          : {
              gitPrNumber: r.value.number,
              gitPrUrl: r.value.url,
              gitPrState: r.value.state,
              gitPrDraft: r.value.isDraft,
              gitPrChecks: r.value.checks,
              gitPrCheckedAt: now(),
            };
    }
    schedule(nextDelay());
    if (JSON.stringify(tuple) !== before) deps.onChange();
  }

  /** `reason:"pr"` → on an absent result, retry at +5 s / +15 s (GitHub lag). */
  function retriesFor(reason: "push" | "pr") {
    return (r: PrStatusProbe | undefined) => {
      if (reason !== "pr" || r?.kind !== "absent") return;
      const retryKey = key;
      for (const delay of PR_OPEN_RETRY_DELAYS_MS) {
        const t = setTimer(() => {
          retryTimers = retryTimers.filter((x) => x !== t);
          if (key !== retryKey || tuple.gitPrNumber != null) return;
          pendingStart = true; // deferred, never dropped, when a probe is in flight
          pump();
        }, delay);
        retryTimers.push(t);
      }
    };
  }

  /** Start whatever is pending, respecting "one in flight" and the forced window. */
  function pump(): void {
    if (!usable() || inFlight) return;
    if (pendingStart) {
      pendingStart = false;
      // Any probe that starts after a forced request satisfies it.
      const reason = pendingForce;
      pendingForce = undefined;
      if (reason) lastForcedStart = now();
      start(reason ? retriesFor(reason) : undefined);
      return;
    }
    if (!pendingForce) return;
    const wait = lastForcedStart + PR_FORCED_WINDOW_MS - now();
    if (wait > 0) {
      // Coalesce into ONE deferred forced probe at the window edge — never dropped.
      windowTimer ??= setTimer(() => {
        windowTimer = undefined;
        pump();
      }, wait);
      return;
    }
    const reason = pendingForce;
    pendingForce = undefined;
    lastForcedStart = now();
    start(retriesFor(reason));
  }

  function dispose(): void {
    disposed = true;
    if (cadenceTimer) clearTimer(cadenceTimer);
    if (windowTimer) clearTimer(windowTimer);
    if (branchTimer) clearTimer(branchTimer);
    if (probeTimeout) clearTimer(probeTimeout);
    cadenceTimer = windowTimer = branchTimer = probeTimeout = undefined;
    clearRetries();
  }

  return {
    tuple: () => ({ ...tuple }),

    observe(next) {
      if (!usable()) return;
      const nextKey = genKey(next);
      if (nextKey === key) return;
      const branchOnly = gen !== undefined && gen.sessionId === next.sessionId && gen.cwd === next.cwd;
      gen = next;
      key = nextKey;
      failures = 0;
      clearRetries();
      if (branchTimer) clearTimer(branchTimer);
      branchTimer = undefined;
      if (branchOnly) {
        tuple = { ...ALL_NULL };
        deps.onChange();
        const wait = lastBranchStart + PR_BRANCH_CHANGE_WINDOW_MS - now();
        if (wait > 0) {
          // Throttled: the latest branch is probed at the window's edge.
          branchTimer = setTimer(() => {
            branchTimer = undefined;
            lastBranchStart = now();
            pendingStart = true;
            pump();
          }, wait);
          return;
        }
        lastBranchStart = now();
      } else {
        tuple = { ...UNKNOWN };
        lastBranchStart = now(); // an unthrottled start also opens the branch-change window
      }
      pendingStart = true;
      pump();
    },

    refresh(reason) {
      if (!usable() || !gen) return;
      clearRetries();
      // Coalesce with any pending forced request; "pr" wins (it carries retries).
      pendingForce = pendingForce === "pr" ? "pr" : reason;
      pump();
    },

    invocations: () => count,

    dispose,
  };
}

/**
 * Bridge `onMessage` branch for `git_info_refresh`. Returns `true` when the
 * message type was consumed. An unknown `reason` is ignored (no probe, no
 * throw) — the same tolerance an older bridge shows the whole message.
 */
export function handleGitInfoRefresh(msg: { type?: unknown; reason?: unknown }, sched: Pick<PrStatusScheduler, "refresh">): boolean {
  if (msg.type !== "git_info_refresh") return false;
  if (msg.reason === "push" || msg.reason === "pr") sched.refresh(msg.reason);
  return true;
}
