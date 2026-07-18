/**
 * goal-supervisor — the goal feature's session supervisor. Lives in the MAIN
 * server (not the goal plugin, which cannot reach `GoalStore`), rides the
 * existing `dispatchPluginSessionEnded` death fanout, and adds ONLY goal
 * pursuit POLICY on top of the host's session-lifecycle mechanism
 * (spawn/token-correlate/death-signal/abort/resume). See design.md.
 *
 * Policy: when a goal's driver dies, classify the death and — for a `pursuing`
 * goal with `autoRespawn` — respawn a driver to keep pursuing, bounded by a
 * cumulative turn budget, a crash-loop breaker, and exponential backoff, so it
 * can never run away.
 *
 * The unlock is one signal: `progress = the dead driver's turnsUsed strictly
 * increased since it spawned`. A death that followed progress is transient
 * (resume the conversation, reset counters); a run of no-progress deaths is
 * the only thing that counts toward giving up.
 *
 * State machine (design.md):
 *   onDriverDeath(sessionId):
 *     not the CURRENT driver of any goal?      → ignore                 (C2e)
 *     goal status terminal/paused?             → ignore
 *     !autoRespawn?                            → paused "session ended"
 *     crash-loop breaker tripped?              → failed "crash loop"
 *     else: madeProgress ? reset : advance;
 *           status=respawning; record respawn; backoff;
 *           spawn (resume | fresh); correlate by token             (S1..S12)
 *
 * All abort paths (clear/pause) go through `abort()`: ONE awaited store write
 * bumps `generation` + writes the terminal status BEFORE the host kill, so the
 * death produced by that kill re-reads the terminal status and is a no-op
 * (breaks the kill→onUnregister→respawn loop). Pending timers + spawn
 * completions are generation-guarded. See change: add-goal-session-supervisor.
 */
import type {
  GoalRecord,
  GoalRecordStatus,
  GoalRespawn,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { GoalStore } from "./goal-store.js";
import { mintSpawnToken } from "../auth/spawn-token.js";

// ── Tunables (design Decision 2; scales match automation's 60s rhythm) ──────

/** Consecutive no-progress *resume*-deaths of one session before switching to a
 *  fresh (re-primed) spawn. The session is "poisoned" — replaying re-dies. */
export const POISON_K = 2;
/** Crash-loop breaker: no-progress deaths within the rolling window → `failed`. */
export const BREAKER_COUNT = 3;
export const BREAKER_WINDOW_MS = 5 * 60_000;
/** Exponential backoff between respawns (ms), indexed by consecutive-no-progress. */
export const RESPAWN_BACKOFF_MS = [5_000, 15_000, 45_000] as const;

// ── Injected dependencies (keeps the module pure + unit-testable) ───────────

/** A concrete spawn the supervisor asks the host to perform. The host owns the
 *  mechanism (spawnPiSession + registry.register with goalId keyed to token). */
export interface GoalDriverSpawnRequest {
  cwd: string;
  goalId: string;
  /** `resume` continues the dead driver's conversation; `fresh` re-primes. */
  reason: "resume" | "fresh";
  /** Pre-minted spawn token (minted BEFORE launch for abortability — C2d). */
  spawnToken: string;
  /** Continue-mode session file (resume only). Absent → fresh. */
  sessionFile?: string;
  /** Re-prime prompt to dispatch once the fresh driver registers. */
  reprime?: string;
}

export interface GoalSupervisorDeps {
  store: GoalStore;
  /** True when a session id currently has a live driver process. */
  isSessionLive: (sessionId: string) => boolean;
  /** Resolve a (dead) driver's session file for continue-mode resume. */
  resolveSessionFile: (sessionId: string) => string | undefined;
  /** Ask the host to spawn a goal driver (headless, goalId stamped to token). */
  spawnDriver: (req: GoalDriverSpawnRequest) => Promise<{ success: boolean; message?: string }>;
  /** Host kill by spawn token (spawn→register window). */
  killByToken: (spawnToken: string) => Promise<boolean>;
  /** Host kill by linked session id. */
  killBySession: (sessionId: string) => Promise<boolean>;
  /** Build the fresh-spawn re-prime prompt (objective + criteria + verdicts). */
  buildReprime: (goal: GoalRecord) => string;
  /** True when the host can spawn headless RPC sessions (auto-respawn requires
   *  it — `/goal` control is only reliable in dashboard-spawned headless). */
  headlessAvailable?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

const TERMINAL: ReadonlySet<GoalRecordStatus> = new Set<GoalRecordStatus>([
  "achieved",
  "cleared",
  "failed",
]);

export interface GoalSupervisor {
  /** Handle a session death (from the `dispatchPluginSessionEnded` fanout).
   *  Fire-and-forget from the fanout; returns the internal handling promise so
   *  callers/tests that need to await completion can. */
  onDriverDeath(sessionId: string): Promise<void>;
  /** Clear/pause a goal: terminal-status-first, generation-guarded, then kill. */
  abort(cwd: string, goalId: string, terminal: { status: GoalRecordStatus; reason?: string }): Promise<void>;
  /** Boot-time reconcile: run the classify path once for any respawning/pursuing
   *  goal whose driver is not live. See change: add-goal-session-supervisor (S10). */
  reconcileOnBoot(): Promise<void>;
  /** Test seam: pending backoff timer count. */
  pendingTimers(): number;
  dispose(): void;
}

export function createGoalSupervisor(deps: GoalSupervisorDeps): GoalSupervisor {
  const { store } = deps;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  const log = deps.log ?? (() => {});
  const headlessAvailable = deps.headlessAvailable ?? (() => true);

  // Pending backoff timers keyed by goalId so abort() can cancel them.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Serialize death handling per session so concurrent deaths don't interleave
  // store reads/writes.
  const chain = new Map<string, Promise<void>>();
  // Per-GOAL lock spanning classify / performSpawn / abort so a death handler
  // cannot record a respawn + flip status after abort() finalized the goal
  // (CodeRabbit: abort-vs-death race). Keyed by goalId.
  const goalLocks = new Map<string, Promise<unknown>>();

  /** Run `fn` under the per-goal lock (serializes classify/performSpawn/abort). */
  function withGoalLock<T>(goalId: string, fn: () => Promise<T>): Promise<T> {
    const prev = goalLocks.get(goalId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    goalLocks.set(goalId, next);
    void next.catch(() => {}).finally(() => {
      if (goalLocks.get(goalId) === next) goalLocks.delete(goalId);
    });
    return next;
  }

  /** Count no-progress deaths within the breaker window that occurred AFTER the
   *  last progress epoch (`lastProgressAt`). Derived from persisted `respawns[]`
   *  so it survives a restart (S8) and ignores stale pre-progress deaths (C2g). */
  function breakerCount(goal: GoalRecord, includeCurrentNoProgress: boolean): number {
    const epoch = goal.lastProgressAt ?? 0;
    const cutoff = now() - BREAKER_WINDOW_MS;
    let n = includeCurrentNoProgress ? 1 : 0;
    for (const r of goal.respawns ?? []) {
      if (!r.madeProgress && r.at > epoch && r.at >= cutoff) n++;
    }
    return n;
  }

  /** Trailing consecutive no-progress RESUME deaths → poisoned session (K). */
  function consecutiveNoProgressResumes(goal: GoalRecord): number {
    let n = 0;
    const list = goal.respawns ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i]!;
      if (r.madeProgress) break;
      if (r.reason !== "resume") break;
      n++;
    }
    return n;
  }

  /** Trailing consecutive no-progress deaths (any reason) → backoff index. */
  function consecutiveNoProgress(goal: GoalRecord): number {
    let n = 0;
    const list = goal.respawns ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.madeProgress) break;
      n++;
    }
    return n;
  }

  /** Backoff for the Nth consecutive no-progress death (1-based: this death is
   *  already recorded in `respawns[]`). 1→5s, 2→15s, 3+→45s cap. */
  function backoffFor(consecutive: number): number {
    const idx = Math.min(Math.max(0, consecutive - 1), RESPAWN_BACKOFF_MS.length - 1);
    return RESPAWN_BACKOFF_MS[idx]!;
  }

  /** Find the goal a session currently drives. Returns null unless it is the
   *  CURRENT `driverSessionId` (late deaths from a replaced driver are ignored
   *  — C2e). */
  async function findCurrentDriverGoal(sessionId: string): Promise<GoalRecord | null> {
    const all = await store.listAll();
    for (const g of all) {
      if (g.driverSessionId === sessionId) return g;
    }
    return null;
  }

  async function handleDeath(sessionId: string): Promise<void> {
    const found = await findCurrentDriverGoal(sessionId);
    if (!found) return; // not a current goal driver — ignore
    // Serialize the classify+schedule under the per-goal lock, and RE-READ the
    // record inside so a concurrent abort() (which finalizes first) is observed.
    await withGoalLock(found.id, async () => {
      const goal = (await store.list(found.cwd)).find((g) => g.id === found.id);
      if (!goal || goal.driverSessionId !== sessionId) return; // replaced/removed
      await classifyDeath(goal, sessionId);
    });
  }

  async function classifyDeath(goal: GoalRecord, sessionId: string): Promise<void> {
    if (TERMINAL.has(goal.status) || goal.status === "paused") {
      // Terminal / already-paused (incl. a death from our own abort kill): no-op.
      return;
    }

    // Progress classification (record-persisted baseline, restart-safe). A
    // known baseline lets us decide strictly: progress = cumulative
    // `totalTurnsUsed` strictly exceeded the baseline captured when this driver
    // became current. A missing baseline (crash before any register, or a
    // pre-change record) is unknown-progress — NOT progress for resume gating,
    // but does NOT count toward the breaker (C2f).
    const baseline = goal.currentDriverBaselineTurns;
    const total = goal.totalTurnsUsed ?? 0;
    const known = baseline !== undefined;
    const madeProgress = known ? total > baseline : false;
    const countsAgainstBreaker = known && !madeProgress;

    if (!goal.autoRespawn) {
      await store.setStatus(goal.cwd, goal.id, "paused", "session ended");
      log("[goal-supervisor] driver ended; autoRespawn off → paused", { goalId: goal.id });
      return;
    }

    if (!headlessAvailable()) {
      await store.setStatus(goal.cwd, goal.id, "paused", "headless unavailable");
      log("[goal-supervisor] headless RPC unavailable → auto-respawn disabled", { goalId: goal.id });
      return;
    }

    // Crash-loop breaker (progress-gated, persisted-derived).
    if (breakerCount(goal, countsAgainstBreaker) >= BREAKER_COUNT) {
      await store.setStatus(goal.cwd, goal.id, "failed", "crash loop");
      log("[goal-supervisor] crash-loop breaker tripped → failed", {
        goalId: goal.id,
        deaths: breakerCount(goal, countsAgainstBreaker),
      });
      return;
    }

    // Decide resume vs fresh AT CLASSIFICATION so the persisted `respawn.reason`
    // matches the spawn actually executed (poison counter reads it). A poisoned
    // session OR a missing continue-mode session file → fresh re-prime.
    const poisoned = consecutiveNoProgressResumes(goal) >= POISON_K;
    const sessionFile = poisoned ? undefined : deps.resolveSessionFile(sessionId);
    const reason: GoalRespawn["reason"] = poisoned || !sessionFile ? "fresh" : "resume";

    // Record this death as a respawn attempt (drives future counters) + flip to
    // the visible respawning state (never `pursuing` with no live driver — S1).
    const respawn: GoalRespawn = { at: now(), sessionId, reason, madeProgress };
    await store.recordRespawn(goal.cwd, goal.id, respawn);
    await store.setStatus(goal.cwd, goal.id, "respawning");

    // Backoff: progress resets to zero; otherwise grow with consecutive count.
    const updated = (await store.list(goal.cwd)).find((g) => g.id === goal.id) ?? goal;
    const backoff = madeProgress ? 0 : backoffFor(consecutiveNoProgress(updated));
    const generationAtSchedule = updated.generation ?? 0;

    log("[goal-supervisor] scheduling respawn", {
      goalId: goal.id,
      reason,
      madeProgress,
      backoffMs: backoff,
    });

    const timer = setTimer(() => {
      timers.delete(goal.id);
      // performSpawn is generation-guarded + lock-serialized; catch so a store
      // I/O failure can't become an unhandled rejection.
      void withGoalLock(goal.id, () =>
        performSpawn(goal.id, goal.cwd, reason, sessionFile, generationAtSchedule),
      ).catch((err) => log("[goal-supervisor] performSpawn failed", { goalId: goal.id, err: String(err) }));
    }, backoff);
    timers.set(goal.id, timer);
  }

  async function performSpawn(
    goalId: string,
    cwd: string,
    reason: GoalRespawn["reason"],
    sessionFile: string | undefined,
    generationAtSchedule: number,
  ): Promise<void> {
    // Re-read: a clear/pause during the backoff bumped `generation` → abort.
    const goal = (await store.list(cwd)).find((g) => g.id === goalId);
    if (!goal) return;
    if ((goal.generation ?? 0) !== generationAtSchedule) {
      log("[goal-supervisor] respawn cancelled (generation changed)", { goalId });
      return;
    }
    if (TERMINAL.has(goal.status) || goal.status === "paused") return;

    const spawnToken = mintSpawnToken();
    // Persist the in-flight spawn BEFORE launch so a restart mid-respawn does
    // not double-spawn (reconcile checks it) and a stale completion can kill it.
    await store.setInFlightSpawn(cwd, goalId, {
      spawnToken,
      generation: generationAtSchedule,
      startedAt: now(),
    });

    const req: GoalDriverSpawnRequest = {
      cwd,
      goalId,
      reason,
      spawnToken,
      ...(reason === "resume" && sessionFile ? { sessionFile } : {}),
      ...(reason === "fresh" ? { reprime: deps.buildReprime(goal) } : {}),
    };

    let result: { success: boolean; message?: string };
    try {
      result = await deps.spawnDriver(req);
    } catch (err) {
      result = { success: false, message: err instanceof Error ? err.message : String(err) };
    }

    // Stale-generation completion (user cleared meanwhile): kill the process we
    // just launched and stop (C2d).
    const after = (await store.list(cwd)).find((g) => g.id === goalId);
    if (!after || (after.generation ?? 0) !== generationAtSchedule) {
      log("[goal-supervisor] spawn completed under stale generation → killing", { goalId });
      await deps.killByToken(spawnToken);
      return;
    }

    if (!result.success) {
      await store.setInFlightSpawn(cwd, goalId, null);
      await store.setStatus(cwd, goalId, "paused", "respawn failed");
      log("[goal-supervisor] respawn spawn failed → paused", { goalId, message: result.message });
      return;
    }
    // Success: the new driver's `session_register` links it via the token path,
    // which clears inFlightSpawn, replaces the driver (capturing a fresh
    // progress baseline), and re-sets status pursuing.
    log("[goal-supervisor] respawn spawned", { goalId, reason });
  }

  function abort(
    cwd: string,
    goalId: string,
    terminal: { status: GoalRecordStatus; reason?: string },
  ): Promise<void> {
    // Serialize with classify/performSpawn so a concurrent death handler cannot
    // record a respawn or flip status after this finalize (CodeRabbit race).
    return withGoalLock(goalId, () => abortLocked(cwd, goalId, terminal));
  }

  async function abortLocked(
    cwd: string,
    goalId: string,
    terminal: { status: GoalRecordStatus; reason?: string },
  ): Promise<void> {
    // (1) ONE awaited write: bump generation + terminal status + clear in-flight
    // spawn. The death handler re-reads AFTER this, so a death from our own kill
    // sees the terminal status and is a no-op (C2h).
    const before = (await store.list(cwd)).find((g) => g.id === goalId);
    const finalized = await store.finalize(cwd, goalId, {
      status: terminal.status,
      ...(terminal.reason !== undefined ? { statusReason: terminal.reason } : {}),
      clearInFlightSpawn: true,
    });
    // (2) Cancel any pending backoff timer (generation now stale).
    const t = timers.get(goalId);
    if (t) {
      clearTimer(t);
      timers.delete(goalId);
    }
    // (3) Host kill: by in-flight token (spawn→register window) else the driver
    // session. If nothing was targeted while an in-flight spawn existed, surface
    // stopping_failed rather than leave a terminal record over a live process.
    const token = before?.inFlightSpawn?.spawnToken;
    let killed = false;
    if (token) killed = await deps.killByToken(token);
    if (!killed && finalized.driverSessionId) {
      killed = await deps.killBySession(finalized.driverSessionId);
    }
    if (!killed && token) {
      // We had an in-flight spawn token but the kill targeted nothing (the
      // process may register momentarily). Leave the terminal status but log —
      // register will see the terminal status and the token completion path
      // kills the late process (C2d).
      log("[goal-supervisor] abort kill targeted nothing (in-flight token)", { goalId });
    }
    log("[goal-supervisor] aborted", { goalId, status: terminal.status });
  }

  async function reconcileOnBoot(): Promise<void> {
    const all = await store.listAll();
    for (const goal of all) {
      if (goal.status !== "pursuing" && goal.status !== "respawning") continue;
      if (goal.driverSessionId && deps.isSessionLive(goal.driverSessionId)) continue; // driver came back
      // A restart between spawn launch and register: the in-flight token's
      // process may still be live — don't double-spawn. Skip; its register or
      // death drives the next step.
      if (goal.inFlightSpawn) {
        log("[goal-supervisor] boot reconcile: in-flight spawn pending, skipping", { goalId: goal.id });
        continue;
      }
      if (goal.driverSessionId) {
        log("[goal-supervisor] boot reconcile: orphaned driver → classify", { goalId: goal.id });
        // No in-memory baseline after restart → unknown-progress (safe).
        await handleDeath(goal.driverSessionId).catch((err) =>
          log("[goal-supervisor] boot reconcile classify failed", { goalId: goal.id, err: String(err) }),
        );
      }
    }
  }

  /** Serialize per-session death handling. */
  function onDriverDeath(sessionId: string): Promise<void> {
    const prev = chain.get(sessionId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => handleDeath(sessionId))
      .catch((err) => log("[goal-supervisor] death handling failed", { sessionId, err: String(err) }));
    chain.set(sessionId, next);
    void next.finally(() => {
      if (chain.get(sessionId) === next) chain.delete(sessionId);
    });
    return next;
  }

  return {
    onDriverDeath,
    abort,
    reconcileOnBoot,
    pendingTimers: () => timers.size,
    dispose() {
      for (const t of timers.values()) clearTimer(t);
      timers.clear();
      chain.clear();
      goalLocks.clear();
    },
  };
}
