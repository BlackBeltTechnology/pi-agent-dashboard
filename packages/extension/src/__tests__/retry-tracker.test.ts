import { describe, expect, it } from "vitest";
import { RetryTracker } from "../retry-tracker.js";

describe("RetryTracker (observe-based, no regex)", () => {
  it("error message_end alone emits nothing and does not mark retrying", () => {
    const t = new RetryTracker();
    const ev = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "overloaded",
    });
    expect(ev).toBeNull();
    // Not yet retrying — pi may retry or give up.
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("a fresh assistant message_start after an error emits auto_retry_start", () => {
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

  it("no regex gate: a would-be non-retryable string still retries if pi restarts", () => {
    const t = new RetryTracker();
    // A string pi historically would NOT retry — but detection is behavioral,
    // so IF a new attempt is observed, we emit auto_retry_start.
    t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "prompt is too long: 300000 tokens > 200000 maximum",
    });
    const ev = t.observeMessageStart("s1", { role: "assistant" });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_start");
  });

  it("message_start with no pending failure emits nothing", () => {
    const t = new RetryTracker();
    expect(t.observeMessageStart("s1", { role: "assistant" })).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("does not track non-assistant message_end", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "user" })).toBeNull();
    expect(t.observeMessageEnd("s1", { role: "toolResult", stopReason: "error" })).toBeNull();
    expect(t.observeMessageStart("s1", { role: "user" })).toBeNull();
  });

  it("does not track an empty errorMessage", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason: "error" })).toBeNull();
    expect(
      t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "" }),
    ).toBeNull();
    // No pending failure recorded → no retry synth on the next attempt.
    expect(t.observeMessageStart("s1", { role: "assistant" })).toBeNull();
  });

  it("increments attempt across successive error → retry cycles", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    const a = t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    const b = t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    const c = t.observeMessageStart("s1", { role: "assistant" });
    expect((a!.data as any).attempt).toBe(1);
    expect((b!.data as any).attempt).toBe(2);
    expect((c!.data as any).attempt).toBe(3);
  });

  it("synthesizes auto_retry_end success on a successful message_end after a retry", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeMessageEnd("s1", { role: "assistant", stopReason: "end_turn" });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data).toEqual({ success: true, attempt: 1 });
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("does not synthesize auto_retry_end when no retry was tracked", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason: "end_turn" })).toBeNull();
  });

  it("synthesizes auto_retry_end failure on agent_end with terminal error", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "rate limit" });
    t.observeMessageStart("s1", { role: "assistant" });
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "rate limit" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "Rate limit exceeded permanently" }],
    });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data).toEqual({
      success: false,
      attempt: 2,
      finalError: "Rate limit exceeded permanently",
    });
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("un-retried error → agent_end returns null (flows via reducer's extractor)", () => {
    const t = new RetryTracker();
    // Error message_end but pi never starts a new attempt (non-retryable).
    t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "invalid api key",
    });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "invalid api key" }],
    });
    expect(ev).toBeNull();
  });

  it("synthesizes auto_retry_end success on agent_end with non-error terminal message", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    t.observeMessageStart("s1", { role: "assistant" });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "end_turn" }],
    });
    expect(ev).not.toBeNull();
    expect((ev!.data as any).success).toBe(true);
  });

  it("agent_end without prior retry returns null", () => {
    const t = new RetryTracker();
    expect(t.observeAgentEnd("s1", { messages: [] })).toBeNull();
  });

  it("noteAbort clears tracker so subsequent agent_end does not double-emit", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    t.observeMessageStart("s1", { role: "assistant" });
    t.noteAbort("s1");
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentEnd("s1", { messages: [] })).toBeNull();
    // Pending failure also cleared — a later message_start does not resurrect.
    expect(t.observeMessageStart("s1", { role: "assistant" })).toBeNull();
  });

  it("scopes retry state per-session", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    t.observeMessageStart("s1", { role: "assistant" });
    expect(t.isRetrying("s1")).toBe(true);
    expect(t.isRetrying("s2")).toBe(false);
  });
});
