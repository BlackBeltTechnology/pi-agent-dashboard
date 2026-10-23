/**
 * The two windows cold-start recovery depends on, in ONE module so the
 * relation between them is expressible (and testable).
 *
 * `announceRestart` tells every connected bridge to suppress its auto-start
 * spawn step for `RESTART_QUIESCE_MS`; a surviving bridge therefore cannot
 * reattach before that window elapses. The reattach grace window is the span
 * during which such a reattach still RETRACTS a recovery candidate. If the
 * grace window closed first (it did: 2500 ms vs 5000 ms) the bridge-reattach
 * liveness channel was arithmetically unreachable on the restart path.
 *
 * See change: fix-recovery-exit-intent (D5).
 *
 * Also owns the (unrelated) shutdown window used to recognise sessions whose
 * pi exited gracefully during a host shutdown, just before the server itself
 * was signalled. See change: fix-recovery-pi-signal-unregister (D3).
 */

/**
 * Bridge quiesce window announced by `POST /api/restart`. Bridges suppress
 * only the spawn step for this long; discovery + reconnection still run.
 */
export const RESTART_QUIESCE_MS = 5000;

/**
 * Shutdown quiesce window announced by the shutdown route (host going down;
 * the orchestrator may take longer to bring a server back than a restart).
 */
export const SHUTDOWN_QUIESCE_MS = 60_000;

/**
 * Hard upper bound on any auto-start pause a bridge honours, whoever asked
 * (`server_restarting` frame, direct `pauseAutoStart` call). A rogue or buggy
 * server cannot hold a bridge's spawn step off indefinitely. Must stay >= 2x
 * the largest value the server itself sends. See change:
 * harden-bridge-inbound-and-discovery (D17).
 */
export const MAX_QUIESCE_MS = 120_000;

/**
 * Normalize an untrusted quiesce duration into the pause a bridge applies.
 * Returns `undefined` (ignore, no pause) for non-numbers, `NaN` and values
 * <= 0. Otherwise rounds a non-integer UP (the window is "at least"
 * `quiesceMs`), then clamps to `MAX_QUIESCE_MS` (`Infinity` included).
 */
export function normalizeQuiesceMs(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return undefined;
  if (value === Infinity) return MAX_QUIESCE_MS;
  return Math.min(Math.ceil(value), MAX_QUIESCE_MS);
}

/**
 * Slack added on top of the quiesce window to cover mDNS re-discovery plus
 * WebSocket reconnect latency once a bridge is allowed to come back.
 */
export const RECONNECT_HEADROOM_MS = 2000;

/**
 * Reattach grace window. A cold-start recovery candidate whose bridge
 * re-registers within this window is a restart survivor, not a loss — it is
 * retracted and its on-disk liveness marker consumed. DERIVED, never a
 * standalone literal: it must outlast the window during which bridges were
 * told not to reconnect.
 */
export const RECOVERY_REATTACH_GRACE_MS = RESTART_QUIESCE_MS + RECONNECT_HEADROOM_MS;

/**
 * Max |endedAt − boot exit time| for a session that ended by an explicit
 * bridge unregister to count as "went down with the host". Measured macOS
 * spacing between pi's graceful exit and the server's SIGTERM: ~23 s.
 * See change: fix-recovery-pi-signal-unregister (D3).
 */
export const RECOVERY_SHUTDOWN_WINDOW_MS = 60_000;
