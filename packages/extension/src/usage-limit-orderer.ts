/**
 * Usage-limit event orderer.
 *
 * Tracks per-session whether an `auto_retry_start` was forwarded without a
 * matching `auto_retry_end`, and — when an `agent_end` arrives whose terminal
 * assistant message has a usage-limit / quota errorMessage — synthesizes an
 * `auto_retry_end { success: false }` to emit BEFORE the `agent_end`.
 *
 * Pure logic (no I/O). The bridge wires this into its forwarding pipeline.
 *
 * See change: fix-provider-retry-infinite-loop.
 */

/**
 * Terminal billing/quota error pattern. Single source of truth lives in
 * `@blackbelt-technology/pi-dashboard-shared/error-patterns`; this module
 * re-exports it for source compatibility with callers that imported it
 * from here historically.
 *
 * See change: unify-status-banner-and-terminal-limit-stop.
 * See change: fix-retry-banner-stuck-on-limit-exceeded (original home).
 */
import { USAGE_LIMIT_PATTERN } from "@blackbelt-technology/pi-dashboard-shared/error-patterns.js";
export { USAGE_LIMIT_PATTERN };

export interface SyntheticEventEnvelope {
  eventType: "auto_retry_end";
  data: { success: false; attempt: -1; finalError: string };
}

export class UsageLimitOrderer {
  /** sessionId → true while a retry is in flight (no auto_retry_end seen yet). */
  private pending = new Set<string>();

  /**
   * Notify the orderer of an outbound `auto_retry_start` for sessionId.
   */
  noteRetryStart(sessionId: string): void {
    this.pending.add(sessionId);
  }

  /**
   * Notify the orderer of an outbound `auto_retry_end` for sessionId.
   * Subsequent `agent_end` events will not synthesize unless a new retry
   * has been started.
   */
  noteRetryEnd(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  /**
   * Inspect an `agent_end` payload. If the terminal message has a
   * usage-limit error AND we have an unmatched retry-start for this session,
   * return the synthetic event the bridge should forward BEFORE the agent_end.
   *
   * Returns null when no synthesis is needed. Always clears the pending flag
   * after a terminal agent_end (errored or not) so we don't double-synthesize.
   */
  maybeSynthesize(
    sessionId: string,
    agentEndData: Record<string, unknown> | undefined,
  ): SyntheticEventEnvelope | null {
    const wasPending = this.pending.has(sessionId);
    // Always clear on agent_end: a terminal turn ends any retry tracking.
    this.pending.delete(sessionId);

    if (!wasPending || !agentEndData) return null;
    const messages = agentEndData.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
    if (!last || last.stopReason !== "error") return null;
    const errorMessage = typeof last.errorMessage === "string" ? last.errorMessage : "";
    if (!errorMessage || !USAGE_LIMIT_PATTERN.test(errorMessage)) return null;

    return {
      eventType: "auto_retry_end",
      data: { success: false, attempt: -1, finalError: errorMessage },
    };
  }

  /** Test-only: inspect pending state. */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }
}
