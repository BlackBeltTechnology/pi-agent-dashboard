/**
 * Bridge wrapper-abort MUST NOT clear usageLimitOrderer's pending flag.
 *
 * Before this change, `bridge.ts`'s abort wrapper called
 * `usageLimitOrderer.noteRetryEnd(sessionId)` immediately after
 * `cachedCtx.abort()`. That disqualified the orderer from synthesizing
 * `auto_retry_end{finalError:errorMessage}` on pi's eventual terminal
 * `agent_end`, swallowing the real provider error.
 *
 * After this change, the wrapper-abort:
 *   - calls retryTracker.noteAbort (so subsequent agent_end doesn't
 *     double-emit auto_retry_end{success:true})
 *   - does NOT call usageLimitOrderer.noteRetryEnd
 *
 * pi's eventual agent_end therefore still triggers the orderer's
 * maybeSynthesize path → real provider error surfaces in lastError.
 *
 * See change: unify-status-banner-and-terminal-limit-stop.
 */

import { describe, it, expect } from "vitest";
import { RetryTracker } from "../retry-tracker.js";
import { UsageLimitOrderer } from "../usage-limit-orderer.js";

/**
 * Mirrors the bridge.ts `abort` wrapper post-honest-mid-turn-queue-surface.
 * The wrapper SHALL NOT call pi.clearSteeringQueue / pi.clearFollowUpQueue
 * (no-ops via ExtensionAPI; modelled by `pi` being intentionally absent
 * here). The wrapper SHALL NOT reset shadow queues. Only cachedCtx.abort
 * + retryTracker.noteAbort run; orderer.noteRetryEnd is intentionally
 * skipped so terminal errors can still surface.
 */
function wrapperAbort(
  sessionId: string,
  tracker: RetryTracker,
  orderer: UsageLimitOrderer,
): void {
  // cachedCtx.abort() runs in real bridge; not modelled here.
  tracker.noteAbort(sessionId);
  // INTENTIONALLY no orderer.noteRetryEnd — see change notes.
}

describe("bridge wrapper-abort + usageLimitOrderer interaction", () => {
  const SID = "session-x";

  it("retryTracker is cleared by wrapper-abort", () => {
    const tracker = new RetryTracker();
    const orderer = new UsageLimitOrderer();
    // Simulate a retry chain in flight.
    tracker.observeMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429 too many requests",
    });
    orderer.noteRetryStart(SID);
    expect(tracker.isRetrying(SID)).toBe(true);
    expect(orderer.hasPending(SID)).toBe(true);

    wrapperAbort(SID, tracker, orderer);

    expect(tracker.isRetrying(SID)).toBe(false);
    // KEY ASSERTION: orderer's pending flag survives the wrapper-abort.
    expect(orderer.hasPending(SID)).toBe(true);
  });

  it("orderer can still synthesize on subsequent agent_end after wrapper-abort", () => {
    const tracker = new RetryTracker();
    const orderer = new UsageLimitOrderer();
    tracker.observeMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "rate limit",
    });
    orderer.noteRetryStart(SID);

    // User aborts.
    wrapperAbort(SID, tracker, orderer);

    // pi eventually emits agent_end with a real provider terminal error.
    const synth = orderer.maybeSynthesize(SID, {
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "usage_limit_reached: monthly cap exhausted",
        },
      ],
    });

    expect(synth).not.toBeNull();
    expect(synth?.eventType).toBe("auto_retry_end");
    expect(synth?.data.success).toBe(false);
    expect(synth?.data.finalError).toBe(
      "usage_limit_reached: monthly cap exhausted",
    );
    // After maybeSynthesize, orderer's pending is cleared internally.
    expect(orderer.hasPending(SID)).toBe(false);
  });

  it("orderer pending stays false when no retry chain was in flight", () => {
    const tracker = new RetryTracker();
    const orderer = new UsageLimitOrderer();
    // No prior auto_retry_start.
    expect(orderer.hasPending(SID)).toBe(false);
    wrapperAbort(SID, tracker, orderer);
    expect(orderer.hasPending(SID)).toBe(false);
  });
});
