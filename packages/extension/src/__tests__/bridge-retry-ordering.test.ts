/**
 * Bridge wire-ordering invariant for synthesized retry events (observe-based).
 *
 * Verifies that the bridge updates `RetryTracker` state SYNCHRONOUSLY when
 * handling `message_start` / `message_end`, so that a back-to-back `agent_end`
 * (fired in the same event-loop tick by pi-coding-agent) observes the
 * up-to-date state and any synthesized `auto_retry_end` lands on the wire
 * BEFORE `agent_end`.
 *
 * Observe-based model (no regex, no usage-limit orderer): an error
 * `message_end` records a pending failure (emits nothing); a following
 * assistant `message_start` emits `auto_retry_start`; a non-error
 * `message_end` or terminal `agent_end` emits `auto_retry_end`.
 *
 * See change: simplify-error-retry-single-card.
 */

import { describe, expect, it } from "vitest";
import { RetryTracker } from "../retry-tracker.js";

interface WireEvent {
  eventType: string;
  data?: Record<string, unknown>;
}

/**
 * Simulates the bridge's synthesizer pipeline as it runs synchronously inside
 * the message_start / message_end / agent_end handlers, capturing all wire
 * sends in order.
 */
class BridgeSim {
  readonly wire: WireEvent[] = [];
  private tracker = new RetryTracker();

  /** Mirrors bridge.ts assistant message_start synthesizer block. */
  onMessageStart(sessionId: string, message: { role: string }): void {
    const synth = this.tracker.observeMessageStart(sessionId, message);
    if (synth) this.wire.push({ eventType: synth.eventType, data: synth.data });
    this.wire.push({ eventType: "message_start" });
  }

  /** Mirrors bridge.ts message_end synthesizer block. */
  onMessageEnd(sessionId: string, message: { role: string; stopReason?: string; errorMessage?: string }): void {
    const synth = this.tracker.observeMessageEnd(sessionId, message);
    if (synth) this.wire.push({ eventType: synth.eventType, data: synth.data });
    // Real bridge defers the message_end body via setTimeout(0); ordering
    // tests only care about the synthetic event relative to agent_end.
    this.wire.push({ eventType: "message_end" });
  }

  /** Mirrors bridge.ts agent_end synthesizer block. */
  onAgentEnd(sessionId: string, agentEnd: { messages?: Array<Record<string, unknown>> }): void {
    const synth = this.tracker.observeAgentEnd(sessionId, agentEnd);
    if (synth) this.wire.push({ eventType: synth.eventType, data: synth.data });
    this.wire.push({ eventType: "agent_end" });
  }
}

describe("Bridge retry-event wire ordering (observe-based)", () => {
  it("retry then terminal failure: auto_retry_end precedes agent_end", () => {
    const sim = new BridgeSim();
    const sessionId = "s1";
    const errorMsg = "429 too many requests";

    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "error", errorMessage: errorMsg });
    sim.onMessageStart(sessionId, { role: "assistant" }); // pi retries
    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "error", errorMessage: errorMsg });
    sim.onAgentEnd(sessionId, {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: errorMsg }],
    });

    const types = sim.wire.map((e) => e.eventType);
    expect(types).toEqual([
      "message_end",
      "auto_retry_start",
      "message_start",
      "message_end",
      "auto_retry_end",
      "agent_end",
    ]);
    // The synthesized end MUST land before agent_end.
    expect(types.indexOf("auto_retry_end")).toBeLessThan(types.indexOf("agent_end"));
    const retryEnd = sim.wire.find((e) => e.eventType === "auto_retry_end")!;
    expect(retryEnd.data).toMatchObject({ success: false, finalError: errorMsg });
  });

  it("retry succeeds: auto_retry_start on message_start, auto_retry_end on success message_end", () => {
    const sim = new BridgeSim();
    const sessionId = "s2";

    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    sim.onMessageStart(sessionId, { role: "assistant" });
    sim.onMessageEnd(sessionId, { role: "assistant", stopReason: "end_turn" });
    sim.onAgentEnd(sessionId, { messages: [{ role: "assistant", stopReason: "end_turn" }] });

    const types = sim.wire.map((e) => e.eventType);
    expect(types).toEqual([
      "message_end",
      "auto_retry_start",
      "message_start",
      "auto_retry_end",
      "message_end",
      "agent_end",
    ]);
    const retryEnd = sim.wire.find((e) => e.eventType === "auto_retry_end")!;
    expect(retryEnd.data).toMatchObject({ success: true });
  });

  it("un-retried terminal error: no synthesis, only message_end + agent_end", () => {
    const sim = new BridgeSim();
    // pi never starts a new attempt (non-retryable) → flows to reducer extractor.
    sim.onMessageEnd("s3", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "prompt is too long: 300000 tokens > 200000 maximum",
    });
    sim.onAgentEnd("s3", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "prompt is too long" }],
    });
    expect(sim.wire.map((e) => e.eventType)).toEqual(["message_end", "agent_end"]);
  });

  it("successful message_end with no prior retry produces no synthesis", () => {
    const sim = new BridgeSim();
    sim.onMessageEnd("s4", { role: "assistant", stopReason: "end_turn" });
    expect(sim.wire.map((e) => e.eventType)).toEqual(["message_end"]);
  });
});
