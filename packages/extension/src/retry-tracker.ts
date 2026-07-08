/**
 * RetryTracker — synthesizes `auto_retry_start` / `auto_retry_end` events from
 * observed pi events.
 *
 * Background: pi's ExtensionAPI does NOT expose `auto_retry_*` events to
 * extensions (verified against pi 0.70/0.73 — see
 * https://github.com/badlogic/pi-mono/discussions/2073). They fire only via
 * `AgentSession._emit → _eventListeners` which only the embedded SDK can
 * subscribe to.
 *
 * Workaround: pi-coding-agent's `_handleRetryableError` fires `message_end`
 * for the failed assistant message BEFORE entering its retry sleep. The
 * bridge sees that `message_end` via `pi.on("message_end")`. By matching
 * the same regex pi-coding-agent uses internally, we can detect that a
 * retry is about to happen and emit our own `auto_retry_start` to the
 * dashboard. When the next non-error `message_end` or `agent_end` arrives,
 * we emit `auto_retry_end`.
 *
 * `delayMs` and `maxAttempts` are unknowable from observed events (pi's
 * settings are not exposed); we send sentinel `-1` for both. The
 * RetryBanner renders an indeterminate "retrying…" UI in that case.
 *
 * See change: fix-provider-retry-infinite-loop.
 */

/**
 * Regex copied verbatim from pi-coding-agent `agent-session.js`
 * `_isRetryableError`. If pi adds new retryable categories, this regex
 * goes stale — but the failure mode is "tracker silently misses some
 * retries", never "tracker breaks". Sync at major pi version bumps.
 */
export const RETRYABLE_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

export interface SyntheticRetryEvent {
  eventType: "auto_retry_start" | "auto_retry_end";
  data: Record<string, unknown>;
}

/** Minimal shape we pluck from a `message_end` event. */
export interface ObservedAssistantMessage {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

export class RetryTracker {
  /** sessionId → 1-based attempt counter for the current retry chain. */
  private attempt = new Map<string, number>();

  /**
   * Process a `message_end` event. Returns a synthetic event the bridge
   * should ALSO forward (after the original message_end), or null.
   */
  observeMessageEnd(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (!message || message.role !== "assistant") return null;

    if (message.stopReason === "error") {
      const err = typeof message.errorMessage === "string" ? message.errorMessage : "";
      if (!err || !RETRYABLE_PATTERN.test(err)) return null;
      const next = (this.attempt.get(sessionId) ?? 0) + 1;
      this.attempt.set(sessionId, next);
      return {
        eventType: "auto_retry_start",
        data: { attempt: next, maxAttempts: -1, delayMs: -1, errorMessage: err },
      };
    }

    // Non-error assistant message — clears any in-flight retry chain.
    if (this.attempt.has(sessionId)) {
      const last = this.attempt.get(sessionId) ?? 0;
      this.attempt.delete(sessionId);
      return { eventType: "auto_retry_end", data: { success: true, attempt: last } };
    }
    return null;
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
  }

  /** Test-only / bridge-coordination: is a retry currently in flight? */
  isRetrying(sessionId: string): boolean {
    return this.attempt.has(sessionId);
  }
}
