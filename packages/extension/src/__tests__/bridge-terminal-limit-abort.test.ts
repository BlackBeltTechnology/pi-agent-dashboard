/**
 * Tests for the bridge's terminal-billing/quota auto-abort logic.
 *
 * Two trigger points:
 *
 *   1. message_end: when an assistant message_end carries a
 *      USAGE_LIMIT_PATTERN match, the bridge invokes cachedCtx.abort() and
 *      synthesizes auto_retry_end{success:false,finalError} so the
 *      dashboard routes straight to the limit-exceeded banner. Skips
 *      pi's pointless retry sleep for a terminal billing error.
 *
 *   2. agent_end (first-attempt branch): when the orderer's maybeSynthesize
 *      returns null (no retry chain was ever in flight, e.g. terminal billing
 *      error fired on the first attempt and RETRYABLE_PATTERN didn't match),
 *      but agent_end's terminal errorMessage matches USAGE_LIMIT_PATTERN,
 *      the bridge synthesizes the same auto_retry_end as the orderer would
 *      have. Without this, first-attempt terminal billing errors would
 *      surface as the generic `error` banner variant.
 *
 * Both paths produce identical wire shapes so the client reducer + banner
 * selector handle them uniformly.
 *
 * See change: unify-status-banner-and-terminal-limit-stop.
 */

import { describe, it, expect } from "vitest";
import { RetryTracker } from "../retry-tracker.js";
import { UsageLimitOrderer } from "../usage-limit-orderer.js";
import { USAGE_LIMIT_PATTERN } from "@blackbelt-technology/pi-dashboard-shared/error-patterns.js";

interface WireEvent {
  eventType: string;
  data?: Record<string, unknown>;
}

/**
 * Simulates the bridge's message_end + agent_end synthesizer pipeline after
 * the unify-status-banner-and-terminal-limit-stop change. Captures wire
 * events in order plus side-effects (cachedCtx.abort calls).
 */
class BridgeSim {
  readonly wire: WireEvent[] = [];
  readonly abortCalls: number[] = [];
  private tracker = new RetryTracker();
  private orderer = new UsageLimitOrderer();

  private cachedCtxAbort = (): void => {
    this.abortCalls.push(Date.now());
  };

  /** Mirrors bridge.ts message_end handler. */
  onMessageEnd(sessionId: string, message: { role: string; stopReason?: string; errorMessage?: string }): void {
    const msgErr = typeof message.errorMessage === "string" ? message.errorMessage : "";
    const isTerminalLimit =
      message.role === "assistant" &&
      message.stopReason === "error" &&
      msgErr.length > 0 &&
      USAGE_LIMIT_PATTERN.test(msgErr);

    if (isTerminalLimit) {
      this.cachedCtxAbort();
      this.wire.push({
        eventType: "auto_retry_end",
        data: { success: false, attempt: -1, finalError: msgErr },
      });
    } else {
      const synthetic = this.tracker.observeMessageEnd(sessionId, message);
      if (synthetic) {
        if (synthetic.eventType === "auto_retry_start") {
          this.orderer.noteRetryStart(sessionId);
        } else {
          this.orderer.noteRetryEnd(sessionId);
        }
        this.wire.push({ eventType: synthetic.eventType, data: synthetic.data });
      }
    }
    this.wire.push({ eventType: "message_end" });
  }

  /** Mirrors bridge.ts agent_end handler. */
  onAgentEnd(sessionId: string, agentEnd: { messages?: Array<Record<string, unknown>> }): void {
    const orderedSynth = this.orderer.maybeSynthesize(sessionId, agentEnd);
    if (orderedSynth) {
      this.wire.push({ eventType: orderedSynth.eventType, data: orderedSynth.data });
      this.tracker.noteAbort(sessionId);
    } else {
      const messages = agentEnd.messages;
      const last =
        Array.isArray(messages) && messages.length > 0
          ? (messages[messages.length - 1] as Record<string, unknown>)
          : undefined;
      const lastErr = typeof last?.errorMessage === "string" ? (last.errorMessage as string) : "";
      const isFirstAttemptTerminalLimit =
        last?.stopReason === "error" && lastErr.length > 0 && USAGE_LIMIT_PATTERN.test(lastErr);
      if (isFirstAttemptTerminalLimit) {
        this.wire.push({
          eventType: "auto_retry_end",
          data: { success: false, attempt: -1, finalError: lastErr },
        });
      } else {
        const trackerSynth = this.tracker.observeAgentEnd(sessionId, agentEnd);
        if (trackerSynth) {
          this.wire.push({ eventType: trackerSynth.eventType, data: trackerSynth.data });
        }
      }
    }
    this.wire.push({ eventType: "agent_end" });
  }
}

const SID = "s-1";

describe("message_end terminal USAGE_LIMIT auto-abort", () => {
  it("calls cachedCtx.abort and synthesizes auto_retry_end with finalError", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "monthly_spending_cap exceeded for project X",
    });

    expect(sim.abortCalls.length).toBe(1);
    expect(sim.wire[0]).toEqual({
      eventType: "auto_retry_end",
      data: { success: false, attempt: -1, finalError: "monthly_spending_cap exceeded for project X" },
    });
    expect(sim.wire[1]).toEqual({ eventType: "message_end" });
    // No auto_retry_start was emitted (we skipped the retry-tracker path)
    expect(sim.wire.some((w) => w.eventType === "auto_retry_start")).toBe(false);
  });

  it("transient rate-limit (RETRYABLE_PATTERN, NOT USAGE_LIMIT) still retries", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429: rate limit; try again in 30s",
    });

    expect(sim.abortCalls.length).toBe(0);
    // Normal path: tracker synthesizes auto_retry_start
    expect(sim.wire[0]?.eventType).toBe("auto_retry_start");
    expect(sim.wire[1]?.eventType).toBe("message_end");
  });

  it("combined string (429 + usage_limit) — USAGE_LIMIT wins", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429: usage_limit_reached — monthly quota",
    });

    expect(sim.abortCalls.length).toBe(1);
    expect(sim.wire[0]?.eventType).toBe("auto_retry_end");
    expect((sim.wire[0]?.data as any).finalError).toBe("429: usage_limit_reached — monthly quota");
    expect((sim.wire[0]?.data as any).success).toBe(false);
  });

  it("non-error stopReason does not auto-abort", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd(SID, {
      role: "assistant",
      stopReason: "end_turn",
    });
    expect(sim.abortCalls.length).toBe(0);
    expect(sim.wire.length).toBe(1); // only message_end
  });

  it("user-role message does not trigger auto-abort", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd(SID, {
      role: "user",
      stopReason: "error",
      errorMessage: "usage_limit_reached",
    });
    // Role check skips both the terminal-limit branch and the retry-tracker.
    expect(sim.abortCalls.length).toBe(0);
    expect(sim.wire.length).toBe(1); // only message_end
  });
});

describe("agent_end first-attempt USAGE_LIMIT branch", () => {
  it("synthesizes auto_retry_end before agent_end when orderer.pending is false", () => {
    const sim = new BridgeSim();
    // No prior auto_retry_start. Directly emit agent_end with terminal billing.
    sim.onAgentEnd(SID, {
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "insufficient_quota for organization X",
        },
      ],
    });

    expect(sim.wire[0]).toEqual({
      eventType: "auto_retry_end",
      data: { success: false, attempt: -1, finalError: "insufficient_quota for organization X" },
    });
    expect(sim.wire[1]).toEqual({ eventType: "agent_end" });
  });

  it("does NOT synth for non-USAGE_LIMIT agent_end error", () => {
    const sim = new BridgeSim();
    sim.onAgentEnd(SID, {
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "tool execution failed: file not found",
        },
      ],
    });

    // No synth from this branch. No prior retry chain so tracker also returns null.
    expect(sim.wire.length).toBe(1);
    expect(sim.wire[0]).toEqual({ eventType: "agent_end" });
  });

  it("does NOT double-fire when orderer.pending was true (existing path wins)", () => {
    const sim = new BridgeSim();
    // Simulate a retry chain in flight (RETRYABLE matches but message also
    // contains USAGE_LIMIT — pi might retry once before realizing).
    sim.onMessageEnd(SID, {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429 too many requests",
    });
    // Now agent_end with terminal USAGE_LIMIT. The orderer's pending is true,
    // so maybeSynthesize fires. The first-attempt branch must NOT also fire.
    sim.onAgentEnd(SID, {
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "usage_limit_reached: monthly cap",
        },
      ],
    });

    // Wire: auto_retry_start, message_end, auto_retry_end (orderer), agent_end
    // Count auto_retry_end events — should be exactly one (from the orderer).
    const ends = sim.wire.filter((w) => w.eventType === "auto_retry_end");
    expect(ends.length).toBe(1);
    expect((ends[0]?.data as any).finalError).toBe("usage_limit_reached: monthly cap");
  });

  it("agent_end with empty messages array is a no-op", () => {
    const sim = new BridgeSim();
    sim.onAgentEnd(SID, { messages: [] });
    expect(sim.wire.length).toBe(1);
    expect(sim.wire[0]?.eventType).toBe("agent_end");
  });
});
