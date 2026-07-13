/**
 * RetryTracker — synthesizes `auto_retry_start` / `auto_retry_end` events by
 * OBSERVING pi's own retry behavior, never by predicting it with a regex.
 *
 * Background: pi's ExtensionAPI does NOT expose `auto_retry_*` events to
 * extensions (verified against pi 0.70/0.73 — see
 * https://github.com/badlogic/pi-mono/discussions/2073). They fire only via
 * `AgentSession._emit → _eventListeners` which only the embedded SDK can
 * subscribe to.
 *
 * Observe-based model (change: simplify-error-retry-single-card):
 * pi owns retry policy; the bridge only observes. pi's `_handleRetryableError`
 * fires `message_end` for the failed assistant message, sleeps, then starts a
 * fresh assistant `message_start` for the next attempt — all within a single
 * agent turn. The tracker keys on exactly that observed sequence:
 *
 *   1. error `message_end`  → record a PENDING failure, emit NOTHING.
 *   2. assistant `message_start` while a failure is pending (no user prompt in
 *      between) → pi re-attempted → emit `auto_retry_start { attempt: N }`.
 *   3. non-error `message_end` while a chain is in flight → `auto_retry_end
 *      { success: true }`.
 *   4. terminal error `agent_end` while a chain is in flight → `auto_retry_end
 *      { success: false, finalError }`.
 *
 * A terminal error pi deems non-retryable (e.g. context overflow) never fires a
 * fresh `message_start`, so no `auto_retry_start` is ever emitted — the error
 * surfaces as an ordinary settled error via `agent_end`.
 *
 * `delayMs` and `maxAttempts` are unknowable from observed events (pi's
 * settings are not exposed); we send sentinel `-1` for both. The banner renders
 * an indeterminate "retrying…" sub-line in that case.
 */

export interface SyntheticRetryEvent {
  eventType: "auto_retry_start" | "auto_retry_end";
  data: Record<string, unknown>;
}

/** Minimal shape we pluck from a `message_start` / `message_end` event. */
export interface ObservedAssistantMessage {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

export class RetryTracker {
  /** sessionId → errorMessage of an error message_end awaiting a re-attempt. */
  private pending = new Map<string, string>();
  /** sessionId → 1-based attempt counter for the in-flight retry chain. */
  private attempt = new Map<string, number>();

  /**
   * Process a `message_end` event.
   *
   * - error assistant message → record a pending failure, return null (the
   *   retry is only confirmed once pi starts a fresh attempt).
   * - non-error assistant message → if a retry chain is in flight, close it
   *   with `auto_retry_end { success: true }`; otherwise clear any stray
   *   pending failure and return null.
   */
  observeMessageEnd(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (!message || message.role !== "assistant") return null;

    if (message.stopReason === "error") {
      const err = typeof message.errorMessage === "string" ? message.errorMessage : "";
      this.pending.set(sessionId, err);
      return null;
    }

    // Non-error assistant completion — clears any pending failure.
    this.pending.delete(sessionId);
    if (this.attempt.has(sessionId)) {
      const last = this.attempt.get(sessionId) ?? 0;
      this.attempt.delete(sessionId);
      return { eventType: "auto_retry_end", data: { success: true, attempt: last } };
    }
    return null;
  }

  /**
   * Process an assistant `message_start` event. If a failure is pending for the
   * session, pi has started a fresh attempt in the same turn → emit
   * `auto_retry_start`. Returns the synthetic event the bridge should forward,
   * or null.
   */
  observeMessageStart(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (!message || message.role !== "assistant") return null;
    if (!this.pending.has(sessionId)) return null;
    const err = this.pending.get(sessionId) ?? "";
    this.pending.delete(sessionId);
    const next = (this.attempt.get(sessionId) ?? 0) + 1;
    this.attempt.set(sessionId, next);
    return {
      eventType: "auto_retry_start",
      data: { attempt: next, maxAttempts: -1, delayMs: -1, errorMessage: err },
    };
  }

  /**
   * Process an `agent_end` event. Always clears any in-flight retry tracking
   * (terminal turn boundary). Only synthesizes when a retry chain was actually
   * in flight: a settled error that pi never re-attempted surfaces through the
   * ordinary `agent_end` error path, not through the retry lifecycle.
   */
  observeAgentEnd(
    sessionId: string,
    agentEndData: { messages?: unknown } | undefined | null,
  ): SyntheticRetryEvent | null {
    const wasRetrying = this.attempt.has(sessionId);
    const last = this.attempt.get(sessionId) ?? -1;
    this.attempt.delete(sessionId);
    this.pending.delete(sessionId);
    if (!wasRetrying) return null;

    const messages = agentEndData?.messages;
    const lastMsg =
      Array.isArray(messages) && messages.length > 0
        ? (messages[messages.length - 1] as ObservedAssistantMessage)
        : undefined;
    if (lastMsg?.stopReason === "error" && typeof lastMsg.errorMessage === "string") {
      return {
        eventType: "auto_retry_end",
        data: { success: false, attempt: last, finalError: lastMsg.errorMessage },
      };
    }
    return { eventType: "auto_retry_end", data: { success: true, attempt: last } };
  }

  /**
   * Notify the tracker of a user abort. Clears in-flight tracking so a
   * subsequent agent_end does not double-emit auto_retry_end.
   */
  noteAbort(sessionId: string): void {
    this.attempt.delete(sessionId);
    this.pending.delete(sessionId);
  }

  /** Test-only / bridge-coordination: is a retry currently in flight? */
  isRetrying(sessionId: string): boolean {
    return this.attempt.has(sessionId);
  }
}
