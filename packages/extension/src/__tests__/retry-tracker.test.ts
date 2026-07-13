import { describe, it, expect } from "vitest";
import { RetryTracker } from "../retry-tracker.js";

/**
 * Observe-based RetryTracker. No regex classification: retry state is derived
 * by OBSERVING pi start a fresh attempt within the same turn (a new assistant
 * `message_start` after an error `message_end`, no intervening user prompt).
 *
 * See change: simplify-error-retry-single-card.
 */
describe("RetryTracker (observe-based)", () => {
  it("records an error message_end but emits NOTHING (retry not yet confirmed)", () => {
    const t = new RetryTracker();
    const ev = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "overloaded",
    });
    expect(ev).toBeNull();
    // No retry chain in flight until pi actually re-attempts.
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("emits auto_retry_start on the assistant message_start that follows an error", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    const ev = t.observeMessageStart("s1", { role: "assistant" });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_start");
    expect(ev!.data).toEqual({
      attempt: 1,
      maxAttempts: -1,
      delayMs: -1,
      errorMessage: "overloaded",
    });
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("does NOT emit auto_retry_start for a message_start with no preceding error", () => {
    const t = new RetryTracker();
    expect(t.observeMessageStart("s1", { role: "assistant" })).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("does NOT emit auto_retry_start for a non-assistant message_start", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    expect(t.observeMessageStart("s1", { role: "user" })).toBeNull();
  });

  it("increments the attempt counter on each observed re-attempt", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    const a = t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    const b = t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    const c = t.observeMessageStart("s1", { role: "assistant" });
    expect((a!.data as any).attempt).toBe(1);
    expect((b!.data as any).attempt).toBe(2);
    expect((c!.data as any).attempt).toBe(3);
  });

  it("emits auto_retry_end{success:true} on a non-error message_end after a retry", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeMessageEnd("s1", { role: "assistant", stopReason: "end_turn" });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_end");
    expect((ev!.data as any).success).toBe(true);
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("does not emit auto_retry_end when no retry chain was in flight", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason: "end_turn" })).toBeNull();
  });

  it("emits auto_retry_end{success:false, finalError} on a terminal error agent_end", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "overloaded permanently" }],
    });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data).toEqual({
      success: false,
      attempt: 2,
      finalError: "overloaded permanently",
    });
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("emits auto_retry_end{success:true} on a non-error agent_end after a retry", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "end_turn" }],
    });
    expect(ev).not.toBeNull();
    expect((ev!.data as any).success).toBe(true);
  });

  it("NON-RETRYABLE: a terminal error pi never re-attempts emits NO auto_retry_start", () => {
    // Context-overflow: pi deems it terminal, never fires a fresh message_start.
    const t = new RetryTracker();
    const end = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "prompt is too long: 300000 tokens > 200000 maximum",
    });
    expect(end).toBeNull();
    // pi terminates the turn — no message_start, straight to agent_end.
    const agentEnd = t.observeAgentEnd("s1", {
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "prompt is too long" },
      ],
    });
    // No retry chain was ever confirmed → tracker emits nothing (agent_end's
    // own error surfacing handles lastError).
    expect(agentEnd).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("agent_end without a prior retry returns null", () => {
    const t = new RetryTracker();
    expect(t.observeAgentEnd("s1", { messages: [] })).toBeNull();
  });

  it("noteAbort clears the chain so a subsequent agent_end does not double-emit", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    t.noteAbort("s1");
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentEnd("s1", { messages: [] })).toBeNull();
  });

  it("scopes retry state per-session", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "overloaded" });
    t.observeMessageStart("s1", { role: "assistant" });
    expect(t.isRetrying("s1")).toBe(true);
    expect(t.isRetrying("s2")).toBe(false);
  });
});
