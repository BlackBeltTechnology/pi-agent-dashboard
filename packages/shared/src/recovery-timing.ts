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
 */

/**
 * Bridge quiesce window announced by `POST /api/restart`. Bridges suppress
 * only the spawn step for this long; discovery + reconnection still run.
 */
export const RESTART_QUIESCE_MS = 5000;

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
