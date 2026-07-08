/**
 * RetryTracker — synthesizes `auto_retry_start` / `auto_retry_end` events from
 * OBSERVED pi events. No regex classification.
 *
 * Background: pi's ExtensionAPI does NOT expose `auto_retry_*` events to
 * extensions (verified against pi 0.70/0.73 — see
 * https://github.com/badlogic/pi-mono/discussions/2073). They fire only via
 * `AgentSession._emit → _eventListeners` which only the embedded SDK can
 * subscribe to.
 *
 * Observe-based rule (change: simplify-error-retry-single-card): the bridge
 * cannot know whether pi will retry an error, so it does NOT predict with a
 * regex copy of pi's `_isRetryableError`. Instead it watches what pi actually
 * does:
 *
 *   - error `message_end` (assistant): record a PENDING failure. Emit nothing
 *     yet — pi may retry (new attempt) or give up (terminal `agent_end`).
 *   - a fresh assistant `message_start` while a failure is pending (same turn,
 *     no intervening user prompt): that observed new attempt IS the retry →
 *     emit `auto_retry_start { attempt: N }`.
 *   - non-error assistant `message_end` while retrying: the attempt succeeded →
 *     emit `auto_retry_end { success: true }`.
 *   - terminal `agent_end` while retrying: emit
 *     `auto_retry_end { success: false, finalError }`.
 *
 * `delayMs` and `maxAttempts` are unknowable from observed events (pi's
 * settings are not exposed); we send sentinel `-1` for both. The banner
 * renders an indeterminate "retrying…" UI in that case. During pi's backoff
 * sleep (after the error `message_end`, before the next `message_start`) no
 * retry sub-line is shown — honest, not guessed.
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
  /** sessionId → 1-based attempt counter for the current retry chain. */
  private attempt = new Map<string, number>();
  /** sessionId → errorMessage of an error message_end awaiting a retry/terminal. */
  private pendingError = new Map<string, string>();

  /**
   * Process a `message_end` event. Records a pending failure on an error, or
   * synthesizes `auto_retry_end` when a retry attempt succeeds.
   */
  observeMessageEnd(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (!message || message.role !== "assistant") return null;

    if (message.stopReason === "error") {
      const err = typeof message.errorMessage === "string" ? message.errorMessage : "";
      // Record the failure regardless of content — a fresh `message_start`
      // (pi retrying) or a terminal `agent_end` (pi giving up) will resolve
      // it. Empty errors carry no context to surface, so skip tracking.
      if (!err) return null;
      this.pendingError.set(sessionId, err);
      return null;
    }

    // Non-error assistant message — a retry attempt succeeded (if one was in
    // flight). Clear both the pending failure and the retry chain.
    this.pendingError.delete(sessionId);
    if (this.attempt.has(sessionId)) {
      const last = this.attempt.get(sessionId) ?? 0;
      this.attempt.delete(sessionId);
      return { eventType: "auto_retry_end", data: { success: true, attempt: last } };
    }
    return null;
  }

  /**
   * Process an assistant `message_start`. When a failure is pending for the
   * session, this observed new attempt IS pi retrying → emit
   * `auto_retry_start`. The caller MUST only pass ASSISTANT message_starts
   * that are NOT a user-initiated new turn (the bridge already distinguishes
   * these via the abort latch / role check).
   */
  observeMessageStart(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (!message || message.role !== "assistant") return null;
    if (!this.pendingError.has(sessionId)) return null;
    const errorMessage = this.pendingError.get(sessionId) ?? "";
    this.pendingError.delete(sessionId);
    const next = (this.attempt.get(sessionId) ?? 0) + 1;
    this.attempt.set(sessionId, next);
    return {
      eventType: "auto_retry_start",
      data: { attempt: next, maxAttempts: -1, delayMs: -1, errorMessage },
    };
  }

  /**
   * Process an `agent_end` event. Returns a synthetic event the bridge
   * should forward BEFORE the original agent_end, or null.
   *
   * Always clears any in-flight retry tracking (terminal turn boundary).
   */
  observeAgentEnd(
    sessionId: string,
    agentEndData: { messages?: unknown } | undefined | null,
  ): SyntheticRetryEvent | null {
    const wasRetrying = this.attempt.has(sessionId);
    const last = this.attempt.get(sessionId) ?? -1;
    this.attempt.delete(sessionId);
    this.pendingError.delete(sessionId);
    if (!wasRetrying) return null;

    // Inspect terminal message for error context.
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
    this.pendingError.delete(sessionId);
  }

  /** Test-only / bridge-coordination: is a retry currently in flight? */
  isRetrying(sessionId: string): boolean {
    return this.attempt.has(sessionId);
  }
}
