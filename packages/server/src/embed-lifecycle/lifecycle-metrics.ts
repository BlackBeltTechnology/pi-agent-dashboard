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
  /** Acquire reuse hits (returned a live session). */
  reuseHits: number;
  /** Acquire reuse misses (spawned or resumed). */
  reuseMisses: number;
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
  recordReuse: (hit: boolean) => void;
  snapshot: () => LifecycleMetricsSnapshot;
}

export function createLifecycleMetrics(deps: LifecycleMetricsDeps = {}): LifecycleMetrics {
  const reaped: Record<ReapReason, number> = { idle: 0, "stop-after-turn": 0, phantom: 0 };
  let capacityRejections = 0;
  let reuseHits = 0;
  let reuseMisses = 0;

  return {
    recordReap: (reason) => {
      reaped[reason] += 1;
    },
    recordCapacityReject: () => {
      capacityRejections += 1;
    },
    recordReuse: (hit) => {
      if (hit) reuseHits += 1;
      else reuseMisses += 1;
    },
    snapshot: () => ({
      activeEphemeral: deps.countActiveEphemeral?.() ?? 0,
      idleEphemeral: deps.countIdleEphemeral?.() ?? 0,
      reaped: { ...reaped },
      capacityRejections,
      reuseHits,
      reuseMisses,
    }),
  };
}
