/**
 * Lifecycle observability counters (D-observability).
 *
 * A tiny in-memory counter store fed by the acquire/reap/cap decision hooks:
 * reuse hit/miss, reaped-by-reason, capacity rejections. Live active/idle counts
 * are computed at snapshot time from injected session accessors (not
 * accumulated), so they always reflect current reality. Exposed via
 * `/api/health` (and/or a JWT-gated diagnostics endpoint) so an operator can
 * answer "why did my embed spawn a second pi" / "why was my session reaped".
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { ReapReason } from "./quiescence.js";

export interface LifecycleMetricsSnapshot {
  /** Live count of active ephemeral sessions. */
  activeEphemeral: number;
  /** Live count of quiescent (idle) ephemeral sessions. */
  idleEphemeral: number;
  /** Cumulative reaps by reason. */
  reaped: Record<ReapReason, number>;
  /** Cumulative capacity rejections. */
  capacityRejections: number;
  /** Cumulative failed reclaims (kill not confirmed, or gear-2 latch undelivered). */
  failedReclaims: number;
  /** Acquire reuse hits (returned a live session). */
  reuseHits: number;
  /** Acquire reuse misses (spawned or resumed). */
  reuseMisses: number;
  /** Reaps of plugin-declared sessions (also counted in `reaped`). */
  declaredReaps: number;
  /** Plugin closer answered `keep`. See change: add-session-close-plugin-hook. */
  closerKeeps: number;
  /** Plugin closer threw, timed out, or answered an unknown value (treated as keep). */
  closerFailures: number;
  /** Accepted plugin `requestSessionClose` calls. */
  pluginCloseRequests: number;
}

export interface LifecycleMetricsDeps {
  /** Live active-ephemeral count (computed at snapshot). */
  countActiveEphemeral?: () => number;
  /** Live idle/quiescent-ephemeral count (computed at snapshot). */
  countIdleEphemeral?: () => number;
}

export interface LifecycleMetrics {
  recordReap: (reason: ReapReason) => void;
  recordCapacityReject: () => void;
  /** A reclaim attempt that did not take effect. See change: fix-session-reclaim-tmux. */
  recordReclaimFailure: () => void;
  recordReuse: (hit: boolean) => void;
  recordDeclaredReap: () => void;
  recordCloserOutcome: (outcome: "close" | "keep" | "failure") => void;
  recordPluginCloseRequest: () => void;
  snapshot: () => LifecycleMetricsSnapshot;
}

export function createLifecycleMetrics(deps: LifecycleMetricsDeps = {}): LifecycleMetrics {
  const reaped: Record<ReapReason, number> = { idle: 0, "stop-after-turn": 0, phantom: 0 };
  let capacityRejections = 0;
  let failedReclaims = 0;
  let reuseHits = 0;
  let reuseMisses = 0;
  let declaredReaps = 0;
  let closerKeeps = 0;
  let closerFailures = 0;
  let pluginCloseRequests = 0;

  return {
    recordReap: (reason) => {
      reaped[reason] += 1;
    },
    recordCapacityReject: () => {
      capacityRejections += 1;
    },
    recordReclaimFailure: () => {
      failedReclaims += 1;
    },
    recordReuse: (hit) => {
      if (hit) reuseHits += 1;
      else reuseMisses += 1;
    },
    recordDeclaredReap: () => {
      declaredReaps += 1;
    },
    recordCloserOutcome: (outcome) => {
      if (outcome === "keep") closerKeeps += 1;
      else if (outcome === "failure") closerFailures += 1;
    },
    recordPluginCloseRequest: () => {
      pluginCloseRequests += 1;
    },
    snapshot: () => ({
      activeEphemeral: deps.countActiveEphemeral?.() ?? 0,
      idleEphemeral: deps.countIdleEphemeral?.() ?? 0,
      reaped: { ...reaped },
      capacityRejections,
      failedReclaims,
      reuseHits,
      reuseMisses,
      declaredReaps,
      closerKeeps,
      closerFailures,
      pluginCloseRequests,
    }),
  };
}
