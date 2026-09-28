/**
 * Trust-failure detection for the team-controls layer (D5).
 *
 * The host trust-gates `assignSessionRef` / `sendExtensionMessage` /
 * `abortSession` on the plugin's manifest `priority`. An untrusted install
 * receives the host's NO-OP: `assignSessionRef` returns `false` and the call
 * silently does nothing.
 *
 * A startup probe was rejected as the mechanism: a probe asserts trust at time
 * T, while what matters is the verb that no-ops at time T+n. So detection is at
 * the CALL SITE — a trusted-gated verb returning the no-op marks the layer
 * unhealthy naming the missing trust level, and the originating command is
 * refused with that reason instead of being reported as done.
 *
 * First cause wins and the state is sticky: the trust level does not repair
 * itself while the process runs, so a later success must not clear it.
 *
 * See change: add-chat-gateway-team-controls (D5).
 */

/** The manifest priority ceiling the host admits to trusted-gated verbs. */
export const TRUSTED_PRIORITY_MAX = 100;

export interface TrustHealthSnapshot {
  healthy: boolean;
  /** Present iff unhealthy. Names the verb and the missing trust level. */
  reason?: string;
}

export interface TrustHealth {
  /** Record a trusted-gated verb's host no-op; returns the (stable) reason. */
  reportTrustFailure(verb: string): string;
  snapshot(): TrustHealthSnapshot;
}

function trustFailureReason(verb: string): string {
  return (
    `trusted-gated verb "${verb}" returned the host no-op — plugin lacks the ` +
    `required trust level (manifest priority must be <= ${TRUSTED_PRIORITY_MAX})`
  );
}

export function createTrustHealth(): TrustHealth {
  let reason: string | undefined;
  return {
    reportTrustFailure(verb) {
      reason ??= trustFailureReason(verb);
      return reason;
    },
    snapshot() {
      return reason === undefined ? { healthy: true } : { healthy: false, reason };
    },
  };
}
