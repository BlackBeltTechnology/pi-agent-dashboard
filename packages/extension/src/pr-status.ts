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
 * - Forced: at most one forced START per 30 s; extra requests coalesce. A
 *   forced request arriving mid-flight sets `forcePending` → one more probe
 *   right after the current one settles (still subject to the 30 s window).
 *   `reason:"pr"` retries at +5 s / +15 s while the result is `absent`
 *   (GitHub lag); `reason:"push"` never retries.
 * - Failure: keep the tuple, back off 120 → 240 → 480 → 600 s (cap); log once
 *   on entering failure and once on recovery.
 * - A probe that has not settled after 20 s is treated as a failure (the
 *   runner also times `gh` out at 20 s; this guards a hung mock / runner).
 */
import type { GitPrChecks, GitPrState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PrStatusProbe } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";

export const PR_PROBE_INTERVAL_MS = 120_000;
export const PR_PROBE_MAX_BACKOFF_MS = 600_000;
export const PR_PROBE_TIMEOUT_MS = 20_000;
export const PR_FORCED_WINDOW_MS = 30_000;
export const PR_OPEN_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/** Wire-shaped PR tuple. `undefined` keys are omitted on the wire. */
export interface PrTuple {
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

  let gen: PrGeneration | undefined;
  let key: string | undefined;
  let tuple: PrTuple = { ...UNKNOWN };
  let inFlight = false;
  let forcePending = false;
  let forcePendingCb: ((r: PrStatusProbe | undefined) => void) | undefined;
  /** A generation change arrived mid-flight: probe the new one after settle. */
  let genPending = false;
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

  const schedule = (delay: number) => {
    if (cadenceTimer) clearTimer(cadenceTimer);
    cadenceTimer = setTimer(() => {
      cadenceTimer = undefined;
      start();
    }, delay);
  };

  const nextDelay = () => (failures === 0 ? PR_PROBE_INTERVAL_MS : Math.min(PR_PROBE_INTERVAL_MS * 2 ** failures, PR_PROBE_MAX_BACKOFF_MS));

  /** Start one probe unless one is in flight / no generation. Returns whether it started. */
  function start(onSettled?: (r: PrStatusProbe | undefined) => void): boolean {
    if (disposed || !gen || inFlight) return false;
    const probeGen = gen;
    const probeKey = key;
    inFlight = true;
    count += 1;
    let settled = false;
    const finish = (r: PrStatusProbe) => {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      inFlight = false;
      if (disposed) return;
      const stale = probeKey !== key;
      if (!stale) apply(r);
      onSettled?.(stale ? undefined : r);
      afterSettle();
    };
    const timeout = setTimer(() => finish({ kind: "failure", reason: `timeout after ${PR_PROBE_TIMEOUT_MS}ms` }), PR_PROBE_TIMEOUT_MS);
    deps.probe(probeGen.cwd).then(finish, (err: unknown) => finish({ kind: "failure", reason: String(err) }));
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

  function afterSettle(): void {
    if (genPending) {
      genPending = false;
      forcePending = false; // the generation probe satisfies any pending force
      forcePendingCb = undefined;
      start();
      return;
    }
    if (forcePending) {
      const cb = forcePendingCb;
      forcePending = false;
      forcePendingCb = undefined;
      forced(cb);
    }
  }

  function forced(onSettled?: (r: PrStatusProbe | undefined) => void): void {
    if (inFlight) {
      forcePending = true;
      forcePendingCb = onSettled ?? forcePendingCb;
      return;
    }
    if (now() - lastForcedStart < PR_FORCED_WINDOW_MS) return; // coalesced
    lastForcedStart = now();
    start(onSettled);
  }

  return {
    tuple: () => ({ ...tuple }),

    observe(next) {
      if (disposed) return;
      const nextKey = genKey(next);
      if (nextKey === key) return;
      const branchOnly = gen !== undefined && gen.sessionId === next.sessionId && gen.cwd === next.cwd;
      gen = next;
      key = nextKey;
      failures = 0;
      clearRetries();
      if (branchOnly) {
        tuple = { ...ALL_NULL };
        deps.onChange();
      } else {
        tuple = { ...UNKNOWN };
      }
      if (inFlight) genPending = true;
      else start();
    },

    refresh(reason) {
      if (disposed || !gen) return;
      clearRetries();
      const retryKey = key;
      forced((r) => {
        if (reason !== "pr" || r?.kind !== "absent") return;
        for (const delay of PR_OPEN_RETRY_DELAYS_MS) {
          const t = setTimer(() => {
            retryTimers = retryTimers.filter((x) => x !== t);
            if (key !== retryKey || tuple.gitPrNumber != null) return;
            start(); // in flight already → that probe fills the tuple
          }, delay);
          retryTimers.push(t);
        }
      });
    },

    invocations: () => count,

    dispose() {
      disposed = true;
      if (cadenceTimer) clearTimer(cadenceTimer);
      clearRetries();
    },
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
