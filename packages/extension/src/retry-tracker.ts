/**
 * RetryTracker — synthesizes `auto_retry_start` / `auto_retry_waiting` /
 * `auto_retry_end` events by OBSERVING pi's own retry behavior, never by
 * predicting it with a regex.
 *
 * Background: pi's ExtensionAPI does NOT expose `auto_retry_*` events to
 * extensions (verified against pi 0.70–0.81 — see
 * https://github.com/badlogic/pi-mono/discussions/2073). They fire only on the
 * RPC stream / embedded-SDK listener channel, which the dashboard's WebSocket
 * bridge cannot read.
 *
 * CORRECTED observation model (change: retry-forever-with-stop-control).
 * pi does NOT keep a retry chain inside one agent turn. Measured against pi
 * 0.81.1, every attempt is a complete `agent_start` … `agent_end` cycle, and
 * exactly ONE `agent_settled` fires after the final `agent_end`:
 *
 *   agent_start → message_end(error) → agent_end          attempt 0 (initial)
 *   [sleep baseDelayMs · 2^0]
 *   agent_start → message_end(error) → agent_end          retry 1
 *   [sleep baseDelayMs · 2^1]
 *   agent_start → message_end(error) → agent_end → agent_settled   TERMINAL
 *
 * The PREVIOUS model keyed on "error message_end then a fresh assistant
 * message_start in the same turn", which never matches this shape — so the
 * tracker synthesized NOTHING and the retry surface was dead in production.
 *
 * Corrected rules:
 *   1. assistant `message_end` with `stopReason:"error"` → record the pending
 *      error text. Emit NOTHING. Do NOT clear the chain.
 *   2. error `agent_end` → an attempt just ended and another is (optimistically)
 *      coming. Advance the retry counter and, when it is still within pi's
 *      budget, emit a WAITING signal carrying the next attempt number, the
 *      computed delay, and the absolute `nextAttemptAt`. Do NOT clear the chain.
 *      (A non-retryable terminal error also lands here; `agent_settled` clears
 *      the mistaken waiting state ~1 ms later — see design D4.)
 *   3. retry `agent_start` (a fresh turn while a chain is active) → the awaited
 *      attempt is now in flight → emit `auto_retry_start` (waiting:false).
 *   4. `agent_settled` → the SOLE terminal signal. Close the chain with
 *      `auto_retry_end` (success = last message not an error) and clear all
 *      per-session tracking.
 *
 * `maxAttempts` / `delayMs` are sourced read-only from pi's retry settings
 * (defaults 3 / 2000). `baseDelayMs === 0` (unreadable settings) yields
 * `delayMs: 0`, which the surface renders elapsed-only. The `-1` sentinels are
 * REMOVED. The tracker never writes pi's settings.
 */

export interface SyntheticRetryEvent {
  eventType: "auto_retry_start" | "auto_retry_waiting" | "auto_retry_end";
  data: Record<string, unknown>;
}

/** Minimal shape we pluck from a `message_start` / `message_end` event. */
export interface ObservedAssistantMessage {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

/** pi retry settings the tracker needs, read-only, for display math. */
export interface RetrySettings {
  /**
   * pi's `retry.enabled`; default true. When false pi never retries, so no
   * waiting signal is emitted at all. This mirrors the first condition of pi's
   * own `_willRetryAfterAgentEnd` predicate.
   */
  enabled: boolean;
  /** pi's `retry.maxRetries`; default 3. */
  maxRetries: number;
  /** pi's `retry.baseDelayMs`; default 2000. 0 = unknown → elapsed-only. */
  baseDelayMs: number;
}

const DEFAULT_SETTINGS: RetrySettings = { enabled: true, maxRetries: 3, baseDelayMs: 2000 };

/** Per-session retry-chain state. */
interface Chain {
  /** Number of the last/next retry (0 = only the initial attempt has failed so far). */
  attempt: number;
  /** Most recent error text, from the error `message_end` / `agent_end`. */
  errorMessage: string;
  /** True when an error `agent_end` armed the next attempt; the next retry
   * `agent_start` consumes it to emit `auto_retry_start`. */
  armed: boolean;
  /** Disposition of the most recent `agent_end`. `agent_settled` reads this to
   * decide success/failure, because native `agent_settled` carries no messages
   * (verified pi 0.81.1). */
  lastEndWasError: boolean;
}

export class RetryTracker {
  private chains = new Map<string, Chain>();
  private readonly settings: RetrySettings;

  constructor(settings?: Partial<RetrySettings>) {
    this.settings = {
      enabled: typeof settings?.enabled === "boolean" ? settings.enabled : DEFAULT_SETTINGS.enabled,
      maxRetries:
        typeof settings?.maxRetries === "number" ? settings.maxRetries : DEFAULT_SETTINGS.maxRetries,
      baseDelayMs:
        typeof settings?.baseDelayMs === "number" ? settings.baseDelayMs : DEFAULT_SETTINGS.baseDelayMs,
    };
  }

  /** `delayMs = baseDelayMs · 2^(attempt-1)`; 0 when the base is unknown. */
  private delayFor(attempt: number): number {
    if (this.settings.baseDelayMs <= 0 || attempt < 1) return 0;
    return this.settings.baseDelayMs * 2 ** (attempt - 1);
  }

  /**
   * Process a fresh `agent_start`. When a chain is armed (an error `agent_end`
   * scheduled the next attempt), this start IS that attempt going in flight →
   * emit `auto_retry_start`. Otherwise (the initial turn, or a non-retry start)
   * emit nothing.
   */
  observeAgentStart(sessionId: string): SyntheticRetryEvent | null {
    const chain = this.chains.get(sessionId);
    if (!chain?.armed) return null;
    chain.armed = false;
    return {
      eventType: "auto_retry_start",
      data: {
        attempt: chain.attempt,
        maxAttempts: this.settings.maxRetries,
        delayMs: this.delayFor(chain.attempt),
        errorMessage: chain.errorMessage,
      },
    };
  }

  /**
   * Process a `message_end`. An error assistant message records the pending
   * error text and opens/keeps the chain; anything else is a no-op here
   * (`agent_settled` decides success). Never clears the chain.
   */
  observeMessageEnd(
    sessionId: string,
    message: ObservedAssistantMessage | undefined | null,
  ): SyntheticRetryEvent | null {
    if (message?.role !== "assistant") return null;
    if (message.stopReason !== "error") return null;
    const err = typeof message.errorMessage === "string" ? message.errorMessage : "";
    const chain = this.chains.get(sessionId);
    if (chain) chain.errorMessage = err;
    else this.chains.set(sessionId, { attempt: 0, errorMessage: err, armed: false, lastEndWasError: true });
    return null;
  }

  /**
   * Process an `agent_end`. When its last message is an error, an attempt just
   * failed and another is optimistically coming: advance the counter, arm the
   * next `agent_start`, and — while still within pi's budget — emit the WAITING
   * signal. The chain is NEVER cleared here; only `agent_settled` terminates it.
   */
  observeAgentEnd(
    sessionId: string,
    agentEndData: { messages?: unknown } | undefined | null,
  ): SyntheticRetryEvent | null {
    const messages = agentEndData?.messages;
    const lastMsg =
      Array.isArray(messages) && messages.length > 0
        ? (messages[messages.length - 1] as ObservedAssistantMessage)
        : undefined;
    const isError = lastMsg?.stopReason === "error";
    if (!isError) {
      // A non-error agent_end closes an active chain SUCCESSFULLY, but the
      // chain stays open until `agent_settled` terminates it. Record the
      // disposition so the settle emits success.
      const existing = this.chains.get(sessionId);
      if (existing) existing.lastEndWasError = false;
      return null;
    }

    const err =
      typeof lastMsg?.errorMessage === "string" && lastMsg.errorMessage.length > 0
        ? lastMsg.errorMessage
        : (this.chains.get(sessionId)?.errorMessage ?? "");
    const chain =
      this.chains.get(sessionId) ?? { attempt: 0, errorMessage: err, armed: false, lastEndWasError: true };
    chain.errorMessage = err;
    chain.attempt += 1;
    chain.armed = true;
    chain.lastEndWasError = true;
    this.chains.set(sessionId, chain);

    // Suppress the waiting signal when pi provably will NOT retry. These are the
    // two conditions of pi's own `_willRetryAfterAgentEnd` predicate that an
    // extension may legitimately read; the third (`_isRetryableError`) is pi's
    // regex classifier and is deliberately NOT replicated — a non-retryable
    // settle is corrected by `agent_settled` instead.
    // See change: retry-forever-with-stop-control (design D4/E9).
    if (!this.settings.enabled) return null;
    if (chain.attempt > this.settings.maxRetries) return null;

    const delayMs = this.delayFor(chain.attempt);
    return {
      eventType: "auto_retry_waiting",
      data: {
        attempt: chain.attempt,
        maxAttempts: this.settings.maxRetries,
        delayMs,
        nextAttemptAt: delayMs > 0 ? Date.now() + delayMs : undefined,
        errorMessage: err,
      },
    };
  }

  /**
   * Process `agent_settled` — the SOLE terminal signal. Closes an active chain
   * with `auto_retry_end` (success = last message is not an error) and clears
   * all per-session tracking. No active chain → nothing.
   */
  observeAgentSettled(sessionId: string): SyntheticRetryEvent | null {
    const chain = this.chains.get(sessionId);
    if (!chain) return null;
    this.chains.delete(sessionId);

    // Native `agent_settled` carries no messages (verified pi 0.81.1), so the
    // disposition comes from the last observed `agent_end`.
    if (chain.lastEndWasError) {
      return {
        eventType: "auto_retry_end",
        data: { success: false, attempt: chain.attempt, finalError: chain.errorMessage },
      };
    }
    return { eventType: "auto_retry_end", data: { success: true, attempt: chain.attempt } };
  }

  /**
   * Notify the tracker of a user abort. Clears the chain so a subsequent
   * `agent_settled` does not double-emit `auto_retry_end`.
   */
  noteAbort(sessionId: string): void {
    this.chains.delete(sessionId);
  }

  /** Test-only / bridge-coordination: is a retry chain currently active? */
  isRetrying(sessionId: string): boolean {
    return this.chains.has(sessionId);
  }
}
