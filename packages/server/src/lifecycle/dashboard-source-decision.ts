/**
 * Pure decision function for whether a `session_register` should be
 * stamped with `source: "dashboard"`.
 *
 * Used by `event-wiring.ts`; extracted as a sibling module so the
 * decision matrix can be unit-tested without spinning up the full
 * gateway / sessionManager / pendingDashboardSpawns machinery.
 *
 * See change: fix-dashboard-source-mislabelling (initial extraction),
 *             fix-dashboard-spawn-correlation-by-token (added
 *             `persistMeta` + `strictCorrelation` to keep the legacy
 *             cwd-FIFO fallback out of the on-disk sidecar).
 */

export interface DashboardSourceDecisionInput {
  /**
   * True when the bridge advertises it was spawned by the dashboard
   * (via `PI_DASHBOARD_SPAWN_TOKEN` env var). Sent on EVERY register,
   * so this is the strong, restart-survival signal.
   */
  dashboardSpawned: boolean | undefined;
  /**
   * Legacy FIFO-by-cwd counter snapshot. Counts up at spawn time,
   * counts down at first registration. Survives nothing across a
   * dashboard restart.
   */
  pendingCount: number;
  /**
   * True when this is the first `session_register` for `sessionId`
   * within the current server process lifetime.
   */
  isNewSession: boolean;
  /**
   * Server-side opt-in (`STRICT_SPAWN_CORRELATION=1` in env). When
   * true, the legacy cwd-FIFO branch is suppressed entirely — only
   * the strong `dashboardSpawned` signal may stamp.
   */
  strictCorrelation: boolean;
}

export interface DashboardSourceDecision {
  /** Whether to stamp `source: "dashboard"` (in-memory + broadcast). */
  shouldStamp: boolean;
  /**
   * Whether the legacy `pendingDashboardSpawns` counter for `cwd`
   * should be consumed by 1. Only true when the legacy signal — not
   * the strong `dashboardSpawned` flag — drove the decision, so old
   * bridges still get correct FIFO accounting and new bridges leave
   * the counter alone (it's a no-op for them).
   */
  consumeLegacyCounter: boolean;
  /**
   * Whether to persist `{ source: "dashboard" }` to the session's
   * `.meta.json` sidecar. True ONLY on the strong-signal branch. The
   * legacy cwd-FIFO branch updates in-memory state for UI continuity
   * but MUST NOT corrupt the sidecar: a CLI register that races a
   * recent dashboard spawn in the same cwd would otherwise persist
   * the wrong tag across restarts.
   */
  persistMeta: boolean;
}

const NO_DECISION: DashboardSourceDecision = {
  shouldStamp: false,
  consumeLegacyCounter: false,
  persistMeta: false,
};

export function decideDashboardSource(
  input: DashboardSourceDecisionInput,
): DashboardSourceDecision {
  // Strong signal: bridge says we spawned it. Trust unconditionally.
  // Persist to sidecar so the tag survives dashboard restarts.
  if (input.dashboardSpawned === true) {
    return {
      shouldStamp: true,
      consumeLegacyCounter: false,
      persistMeta: true,
    };
  }
  // Strict mode: refuse the legacy fallback. Only the strong signal
  // above can stamp.
  if (input.strictCorrelation) {
    return NO_DECISION;
  }
  // Legacy FIFO: only fires on first register AND when the counter
  // shows a pending spawn for this cwd. Stamp in memory for UI
  // continuity but do NOT persist — cwd-only is a weak signal.
  if (input.pendingCount > 0 && input.isNewSession) {
    return {
      shouldStamp: true,
      consumeLegacyCounter: true,
      persistMeta: false,
    };
  }
  return NO_DECISION;
}
