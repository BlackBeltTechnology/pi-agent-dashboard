/**
 * Bridge wire-ordering invariant for synthesized retry events.
 *
 * Verifies that the bridge updates `RetryTracker` + `UsageLimitOrderer` state
 * SYNCHRONOUSLY when handling `message_end`, so that a back-to-back `agent_end`
 * (fired in the same event-loop tick by pi-coding-agent) observes the
 * up-to-date state.
 *
 * Pre-fix bug: the synthesizer state lived inside `setTimeout(0)` (intended
 * for entryId capture per `fix-per-message-fork`), so `agent_end` was
 * processed BEFORE the trackers had been updated, the orderer's pending
 * flag was never set, and `auto_retry_start` shipped on the wire AFTER
 * `agent_end` — leaving the dashboard's `retryState` stuck (yellow + red
 * banners both visible).
 *
 * See change: fix-retry-banner-stuck-on-limit-exceeded.
 */

import { describe, it, expect } from "vitest";
import { RetryTracker } from "../retry-tracker.js";
import { UsageLimitOrderer } from "../usage-limit-orderer.js";

interface WireEvent {
  eventType: string;
  data?: Record<string, unknown>;
}

/**
 * Simulates the bridge's synthesizer pipeline as it runs synchronously
 * inside the message_end / agent_end handlers, capturing all wire sends
 * in order.
 */
class BridgeSim {
  readonly wire: WireEvent[] = [];
  private tracker = new RetryTracker();
  private orderer = new UsageLimitOrderer();

  /** Mirrors bridge.ts message_end handler synthesizer block. */
  onMessageEnd(sessionId: string, message: { role: string; stopReason?: string; errorMessage?: string }): void {
    const synthetic = this.tracker.observeMessageEnd(sessionId, message);
    if (synthetic) {
      if (synthetic.eventType === "auto_retry_start") {
        this.orderer.noteRetryStart(sessionId);
      } else {
        this.orderer.noteRetryEnd(sessionId);
      }
      this.wire.push({ eventType: synthetic.eventType, data: synthetic.data });
    }
    // The actual message_end body send is deferred via setTimeout(0) in the
    // real bridge for entryId capture; for ordering tests we only care about
    // the synthetic events relative to agent_end.
    this.wire.push({ eventType: "message_end" });
  }

  /** Mirrors bridge.ts agent_end handler synthesizer block. */
  onAgentEnd(sessionId: string, agentEnd: { messages?: Array<Record<string, unknown>> }): void {
    const orderedSynth = this.orderer.maybeSynthesize(sessionId, agentEnd);
    if (orderedSynth) {
      this.wire.push({ eventType: orderedSynth.eventType, data: orderedSynth.data });
      this.tracker.noteAbort(sessionId);
    } else {
      const trackerSynth = this.tracker.observeAgentEnd(sessionId, agentEnd);
      if (trackerSynth) {
        this.wire.push({ eventType: trackerSynth.eventType, data: trackerSynth.data });
      }
    }
    this.wire.push({ eventType: "agent_end" });
  }
}

describe("Bridge retry-event wire ordering", () => {
  it("agent_end fired back-to-back after retryable message_end observes pending retry", () => {
    const sim = new BridgeSim();
    const sessionId = "s1";
    const errorMsg = "429 too many requests";

    // Pi fires both events synchronously back-to-back.
    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "error", errorMessage: errorMsg });
    sim.onAgentEnd(sessionId, {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: errorMsg }],
    });

    const types = sim.wire.map((e) => e.eventType);
    // auto_retry_start must precede message_end, which must precede the
    // agent_end-side synthesis. Since the same retryable error is the
    // terminal message, retryTracker.observeAgentEnd surfaces a final
    // auto_retry_end{success:false, finalError:errorMsg} BEFORE agent_end.
    expect(types).toEqual([
      "auto_retry_start",
      "message_end",
      "auto_retry_end",
      "agent_end",
    ]);
    // auto_retry_start MUST come before agent_end on the wire.
    const startIdx = types.indexOf("auto_retry_start");
    const agentEndIdx = types.indexOf("agent_end");
    expect(startIdx).toBeLessThan(agentEndIdx);
  });

  it("Gemini monthly-spending-cap error orders auto_retry_end before agent_end", () => {
    const sim = new BridgeSim();
    const sessionId = "s2";
    // Real fixture from ~/.pi/agent/sessions/...BME-szakdoga.../*.jsonl line 363
    const errorMsg = JSON.stringify({
      error: {
        message:
          "Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.",
        status: "RESOURCE_EXHAUSTED",
      },
      code: 429,
      status: "Too Many Requests",
    });

    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "error", errorMessage: errorMsg });
    sim.onAgentEnd(sessionId, {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: errorMsg }],
    });

    const types = sim.wire.map((e) => e.eventType);
    expect(types).toEqual([
      "auto_retry_start",
      "message_end",
      "auto_retry_end",
      "agent_end",
    ]);
    // The synthetic auto_retry_end MUST come from the usage-limit orderer
    // (not the retry-tracker fallback) because the broadened
    // USAGE_LIMIT_PATTERN matches "monthly spending cap" / RESOURCE_EXHAUSTED.
    const retryEnd = sim.wire.find((e) => e.eventType === "auto_retry_end")!;
    expect(retryEnd.data).toMatchObject({ success: false, finalError: errorMsg });
  });

  it("non-retryable message_end produces no synthesis (only message_end on wire)", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd("s3", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "prompt is too long: 300000 tokens > 200000 maximum",
    });
    expect(sim.wire.map((e) => e.eventType)).toEqual(["message_end"]);
  });

  it("successful message_end with no prior retry produces no synthesis", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd("s4", { role: "assistant", stopReason: "end_turn" });
    expect(sim.wire.map((e) => e.eventType)).toEqual(["message_end"]);
  });
});
