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
  /** Fires on every applied (confirmed / delivered) reap for the diagnostics counters. */
  onReap?: (sessionId: string, reason: ReapReason) => void;
  /** Fires when a reclaim attempt did not take effect (failed kill or undelivered latch). */
  onReclaimFailed?: (sessionId: string, reason: ReapReason, result: TerminateResult | undefined) => void;
  /** Give-up state shared with the caps gate (created locally when omitted). */
  giveUp?: ReclaimGiveUpTracker;
  /** Injectable clock. */
  now?: () => number;
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

  async function reapOne(s: DashboardSession, t: LifecycleThresholds): Promise<void> {
    if (reaping.has(s.id)) return;
    if (giveUp.isGivenUp(s.id)) return; // wedged; stay quiet, stay listed
    const verdict = decideReap(await assembleSignals(s), t, now());
    if (verdict.action !== "reap") return;

    reaping.add(s.id);
    try {
      if (verdict.reason === "stop-after-turn") {
        // Terminates nothing: counted on delivery of the latch. Undelivered is
        // a transient transport state — retried next sweep, never given up.
        if (deps.sendStopAfterTurn(s.id)) {
          deps.onReap?.(s.id, verdict.reason);
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
        deps.onReap?.(s.id, verdict.reason);
      } else {
        reportFailedKill(s.id, verdict.reason, result);
      }
    } finally {
      reaping.delete(s.id);
    }
  }

  async function sweepOnce(): Promise<void> {
    const cfg = deps.config();
    if (!cfg.enabled) return; // dormant when the feature is off (E22)
    const t = toThresholds(cfg);
    const sessions = deps.listSessions();
    giveUp.prune(new Set(sessions.map((s) => s.id)));
    for (const s of sessions) {
      if (s.status === "ended") continue; // already gone
      if (!isEphemeral(s)) continue; // durable sessions are never governed (E1)
      // Isolate per-session failures: a throwing probe / kill must not reject
      // the whole sweep (which runs unattended via setInterval → unhandled
      // rejection) nor skip the remaining sessions.
      try {
        await reapOne(s, t);
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
