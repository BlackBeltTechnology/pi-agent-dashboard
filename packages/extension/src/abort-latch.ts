/**
 * AbortLatch — keeps a user abort "latched" so pi's in-flight retry is stopped
 * even when the provider backoff (5–60 s) outlives the 2 s persistent-abort
 * scheduler.
 *
 * Background: pi-coding-agent retries internally and exposes NO retry events.
 * On `abort`, the bridge runs a wrapper-abort once + a 200 ms persistent-abort
 * scheduler capped at 2 s. A long rate-limit backoff sleeps past that window;
 * pi then wakes and resumes the retry with a fresh `_retryAbortController` that
 * never saw the abort signal — so the retry continues despite the user pressing
 * Stop / Dismiss.
 *
 * Fix: latch an `abortRequested` flag per session when the abort arrives. The
 * latch operates as **abort-on-sight** scoped to the aborted turn — whenever
 * the bridge observes the aborted turn resuming (a fresh assistant
 * `message_start` / `agent_start` with no intervening user prompt), it calls
 * `cachedCtx.abort()` again. The latch is cleared the instant a NEW user prompt
 * is sent (so the user's deliberate new turn is never killed) or the aborted
 * turn settles (`agent_end` / idle). "No intervening user prompt" is thus the
 * discriminator without needing a retry signal from pi.
 *
 * See change: unify-error-retry-lifecycle (design D3b).
 */
export class AbortLatch {
  /** sessionIds with a pending latched abort. */
  private active = new Set<string>();

  /** User requested abort — latch on until a new user prompt or settle. */
  request(sessionId: string): void {
    this.active.add(sessionId);
  }

  /**
   * True iff an abort is latched for this session. Called when the bridge
   * observes the aborted turn resuming; a `true` return means the bridge
   * should issue a fresh `cachedCtx.abort()` to honor the latch.
   */
  shouldAbort(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /**
   * Clear the latch. Called when (a) a NEW user prompt is dispatched for the
   * session (deliberate new turn), or (b) the aborted turn settles
   * (`agent_end` / idle).
   */
  clear(sessionId: string): void {
    this.active.delete(sessionId);
  }

  /** Test / bridge-coordination: is the latch currently set? */
  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }
}
