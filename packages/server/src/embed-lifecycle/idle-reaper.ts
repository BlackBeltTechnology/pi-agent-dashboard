/**
 * Idle reaper loop (three gears) for machine-fronted `ephemeral` sessions.
 *
 * A thin orchestrator around the pure `decideReap` core: per sweep it assembles
 * a `LifecycleSignals` snapshot for each ephemeral session from injected live
 * deps (liveness probe, subscriber/terminal/ask/queue sources), asks
 * `decideReap` for a verdict, and applies it:
 *   - gear 1 `idle`            → `terminate` (shared ladder, any spawn strategy)
 *   - gear 2 `stop-after-turn` → `sendStopAfterTurn` (finish turn, clean exit)
 *   - gear 3 `phantom`         → `terminate` (SAME graceful ladder, NOT a
 *                                bare SIGKILL — bounds the session-file
 *                                mid-write window, keeps resume intact) (E16)
 *
 * A kill reap is counted (`onReap`) only on CONFIRMED termination; a failed
 * reclaim is logged, counted (`onReclaimFailed`), retried, and given up on
 * after a bound (shared tracker). Gear 2 is counted on latch delivery.
 *
 * All policy lives in `decideReap`; this file only maps live state → signals and
 * verdict → action, so it stays trivially injectable for tests (no server
 * instance, fake deps). Dormant when `config().enabled` is false (E22).
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { EmbedLifecycleConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { TerminateResult } from "../spawn-process/session-terminator.js";
import type { LivenessProbe } from "./liveness-probe.js";
import {
  decideReap,
  type LifecycleSignals,
  type LifecycleThresholds,
  type ReapReason,
} from "./quiescence.js";
import { createReclaimGiveUpTracker, type ReclaimGiveUpTracker } from "./reclaim-give-up.js";
import { isEphemeral } from "./session-lifecycle-policy.js";

/** CPU% at or below which a pi tree counts as "~0 CPU" for phantom detection. */
export const CPU_IDLE_THRESHOLD = 1;

export interface ReaperDeps {
  /** Live config read each sweep (so an operator toggle takes effect). */
  config: () => EmbedLifecycleConfig;
  /** All known sessions (durable ones are filtered out here). */
  listSessions: () => readonly DashboardSession[];
  /** Bounded pid-tree + CPU probe. */
  probe: LivenessProbe;
  /** A browser is currently subscribed to the session. */
  hasSubscriber: (sessionId: string) => boolean;
  /** A live terminal PTY shares the cwd. */
  hasTerminalInCwd: (cwd: string) => boolean;
  /** An unanswered `ask_user` is tracked for the session. */
  hasPendingAsk: (sessionId: string) => boolean;
  /** Queued follow-up / steering counts (pi in-memory queue mirror). */
  queueCounts: (sessionId: string) => { followUp: number; steering: number };
  /** Shared terminator: SIGTERM→grace→SIGKILL, confirmed (gear 1 + gear 3). */
  terminate: (sessionId: string) => Promise<TerminateResult>;
  /** Latch `stop_after_turn` so the session ends cleanly at `turn_end` (gear 2). Returns whether it was delivered. */
  sendStopAfterTurn: (sessionId: string) => boolean;
  /**
   * Fires on every applied (confirmed / delivered) reap for the diagnostics
   * counters. `declared` carries the declaring plugin id for a plugin-governed
   * session. See change: add-session-close-plugin-hook.
   */
  onReap?: (sessionId: string, reason: ReapReason, declared?: { owner: string }) => void;
  /** Fires when a reclaim attempt did not take effect (failed kill or undelivered latch). */
  onReclaimFailed?: (sessionId: string, reason: ReapReason, result: TerminateResult | undefined) => void;
  /** Give-up state shared with the caps gate (created locally when omitted). */
  giveUp?: ReclaimGiveUpTracker;
  /** Injectable clock. */
  now?: () => number;
  /**
   * Closer of the plugin that declared a session's close policy (undefined ⇒
   * none registered ⇒ close). See change: add-session-close-plugin-hook.
   */
  closerFor?: (ownerId: string) => SessionCloser | undefined;
  /** The declaring plugin requested a close at the next quiet point. */
  isCloseRequested?: (sessionId: string) => boolean;
  /** Drop a close request once the session is closed. */
  clearCloseRequest?: (sessionId: string) => void;
  /** Close mode `archive`: mark the session archive-on-end (+ persist). */
  markArchiveOnEnd?: (sessionId: string) => void;
  /** Closer outcome hook (logs + counters). */
  onCloserVerdict?: (sessionId: string, owner: string, reason: ReapReason, outcome: CloserOutcome) => void;
  /** Wall clock for the closer budget (fake-timer friendly; distinct from `now`). */
  elapsedClock?: () => number;
}

/** Plugin closer: `"close"` | `"keep"`; anything else / throw / timeout ⇒ keep. */
export type SessionCloser = (req: {
  sessionId: string;
  cwd: string;
  reason: ReapReason;
  idleMs: number;
}) => unknown;

/** Outcome of one closer consult. `failure` = throw / timeout / unknown value. */
export type CloserOutcome = "close" | "keep" | "failure";

/** Per-call closer bound. */
export const CLOSER_TIMEOUT_MS = 1000;
/** Total closer time per sweep; candidates past it are deferred, never closed. */
export const CLOSER_SWEEP_BUDGET_MS = 5000;

/** Governed = a plugin declared an idle close policy for the session. */
export function isPluginGoverned(s: Pick<DashboardSession, "closePolicy">): boolean {
  return typeof s.closePolicy?.idleAfterMs === "number";
}

/** Call a closer with the per-call bound; never throws. */
async function consultCloser(closer: SessionCloser, req: Parameters<SessionCloser>[0]): Promise<CloserOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CLOSER_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const v = await Promise.race([Promise.resolve().then(() => closer(req)), timeout]);
    return v === "close" || v === "keep" ? v : "failure";
  } catch {
    return "failure";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface IdleReaper {
  /** Run one sweep across all ephemeral sessions. */
  sweepOnce: () => Promise<void>;
  /** Start the periodic sweep on the config cadence. */
  start: () => void;
  /** Stop the periodic sweep. */
  stop: () => void;
}

function toThresholds(cfg: EmbedLifecycleConfig): LifecycleThresholds {
  return {
    idleTimeoutMs: cfg.idleTimeoutSeconds * 1000,
    graceWindowMs: cfg.graceWindowSeconds * 1000,
    hardCeilingMs: cfg.hardCeilingSeconds * 1000,
  };
}

export function createIdleReaper(deps: ReaperDeps): IdleReaper {
  const now = deps.now ?? Date.now;
  const elapsed = deps.elapsedClock ?? Date.now;
  // Guards against re-selecting a session already mid-reap across overlapping
  // sweeps (and, later, coordinating with the caps reclaim path).
  const reaping = new Set<string>();
  const giveUp = deps.giveUp ?? createReclaimGiveUpTracker();
  let timer: ReturnType<typeof setInterval> | undefined;

  async function assembleSignals(s: DashboardSession): Promise<LifecycleSignals> {
    const probeSnap =
      typeof s.pid === "number"
        ? await deps.probe(s.pid)
        : { ok: false, childCount: 0, cpuPercent: 0 };
    const q = deps.queueCounts(s.id);
    return {
      lifecyclePolicy: s.lifecyclePolicy,
      governed: isPluginGoverned(s),
      idleTimeoutMs: s.closePolicy?.idleAfterMs,
      closeRequested: deps.isCloseRequested?.(s.id) ?? false,
      lastSettledAt: s.lastSettledAt,
      lastRunStartedAt: s.lastRunStartedAt,
      currentTool: s.currentTool,
      hasPendingAsk: deps.hasPendingAsk(s.id),
      followUpCount: q.followUp,
      steeringCount: q.steering,
      // Unknown probe ⇒ assume a live child (never idle-reap on unknown) and
      // NOT cpu-idle (never phantom-reap on unknown) — both the SAFE direction.
      hasLiveChild: probeSnap.ok ? probeSnap.childCount > 0 : true,
      hasTerminalInCwd: deps.hasTerminalInCwd(s.cwd),
      hasSubscriber: deps.hasSubscriber(s.id),
      activatedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      cpuIdle: probeSnap.ok ? probeSnap.cpuPercent <= CPU_IDLE_THRESHOLD : false,
    };
  }

  /** Terminator call whose throw is a failed reclaim, not a skipped one. */
  async function safeTerminate(id: string): Promise<TerminateResult> {
    try {
      return await deps.terminate(id);
    } catch (err) {
      console.warn(`[embed-lifecycle] terminate(${id}) threw:`, err);
      return { outcome: "unconfirmed", terminated: false };
    }
  }

  function reportFailedKill(id: string, reason: ReapReason, result: TerminateResult): void {
    const pid = result.pid ?? "unknown";
    console.warn(`[embed-lifecycle] reclaim(${id}, ${reason}): ${result.outcome}, process ${pid} survived`);
    deps.onReclaimFailed?.(id, reason, result);
    if (giveUp.recordFailure(id, result.outcome)) {
      console.error(
        `[embed-lifecycle] reclaim(${id}, ${reason}): giving up — outcome ${result.outcome}, process ${pid}; ` +
          "session stays listed, operator action required (force-kill / shutdown)",
      );
    }
  }

  /** Per-sweep closer budget (ms spent so far). */
  interface SweepBudget {
    spentMs: number;
  }

  /**
   * Ask the declaring plugin's closer, within the per-sweep budget. `true` ⇒
   * proceed with the close. Only plugin-governed sessions that are not
   * close-requested reach a closer (a request is the plugin's own decision).
   * See change: add-session-close-plugin-hook.
   */
  async function closerAllows(
    s: DashboardSession,
    signals: LifecycleSignals,
    reason: ReapReason,
    budget: SweepBudget,
  ): Promise<boolean> {
    const owner = s.closePolicy?.owner;
    if (!owner || !signals.governed || signals.closeRequested) return true;
    const closer = deps.closerFor?.(owner);
    if (!closer) return true; // no closer registered ⇒ close
    if (budget.spentMs >= CLOSER_SWEEP_BUDGET_MS) return false; // deferred to next sweep
    const startedAt = elapsed();
    const outcome = await consultCloser(closer, {
      sessionId: s.id,
      cwd: s.cwd,
      reason,
      idleMs: signals.lastActivityAt === undefined ? 0 : Math.max(0, now() - signals.lastActivityAt),
    });
    budget.spentMs += Math.max(0, elapsed() - startedAt);
    deps.onCloserVerdict?.(s.id, owner, reason, outcome);
    return outcome === "close";
  }

  async function reapOne(s: DashboardSession, t: LifecycleThresholds, budget: SweepBudget): Promise<void> {
    if (reaping.has(s.id)) return;
    if (giveUp.isGivenUp(s.id)) return; // wedged; stay quiet, stay listed
    const signals = await assembleSignals(s);
    const verdict = decideReap(signals, t, now());
    if (verdict.action !== "reap") return;

    reaping.add(s.id);
    try {
      if (!(await closerAllows(s, signals, verdict.reason, budget))) return;
      const owner = s.closePolicy?.owner;
      const declared = owner && (signals.governed || signals.closeRequested) ? { owner } : undefined;
      // Close mode `archive`: mark before the close so the on-end archive fires.
      if (declared && s.closePolicy?.mode === "archive") deps.markArchiveOnEnd?.(s.id);
      if (verdict.reason === "stop-after-turn") {
        // Terminates nothing: counted on delivery of the latch. Undelivered is
        // a transient transport state — retried next sweep, never given up.
        if (deps.sendStopAfterTurn(s.id)) {
          deps.onReap?.(s.id, verdict.reason, declared);
        } else {
          console.warn(`[embed-lifecycle] reclaim(${s.id}, stop-after-turn): latch not delivered`);
          deps.onReclaimFailed?.(s.id, verdict.reason, undefined);
        }
        return;
      }
      // idle + phantom both use the graceful, resumable kill ladder.
      const result = await safeTerminate(s.id);
      if (result.terminated) {
        giveUp.clear(s.id);
        deps.clearCloseRequest?.(s.id);
        deps.onReap?.(s.id, verdict.reason, declared);
      } else {
        reportFailedKill(s.id, verdict.reason, result);
      }
    } finally {
      reaping.delete(s.id);
    }
  }

  /**
   * In scope this sweep: ephemeral (only while the feature is enabled), or
   * plugin-governed / close-requested (always — the declaration is the opt-in).
   * See change: add-session-close-plugin-hook.
   */
  function inScope(s: DashboardSession, enabled: boolean): boolean {
    if (s.status === "ended") return false; // already gone
    if (enabled && isEphemeral(s)) return true;
    return isPluginGoverned(s) || (deps.isCloseRequested?.(s.id) ?? false);
  }

  async function sweepOnce(): Promise<void> {
    const cfg = deps.config();
    const sessions = deps.listSessions();
    // Durable undeclared sessions are never governed (E1); with the feature off
    // and nothing declared this is a no-work pass, as before (E22).
    giveUp.prune(new Set(sessions.map((s) => s.id)));
    const candidates = sessions.filter((s) => inScope(s, cfg.enabled));
    if (candidates.length === 0) return;
    const t = toThresholds(cfg);
    const budget: SweepBudget = { spentMs: 0 };
    for (const s of candidates) {
      // Isolate per-session failures: a throwing probe / kill must not reject
      // the whole sweep (which runs unattended via setInterval → unhandled
      // rejection) nor skip the remaining sessions.
      try {
        await reapOne(s, t, budget);
      } catch (err) {
        console.warn(`[embed-lifecycle] reap sweep failed for ${s.id}:`, err);
      }
    }
  }

  return {
    sweepOnce,
    start() {
      if (timer) return;
      const intervalMs = Math.max(1, deps.config().sweepIntervalSeconds) * 1000;
      timer = setInterval(() => {
        void sweepOnce();
      }, intervalMs);
      // Do not keep the process alive solely for the reaper.
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
