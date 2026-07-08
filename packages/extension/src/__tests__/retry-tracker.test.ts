import { describe, it, expect } from "vitest";
import { RetryTracker, RETRYABLE_PATTERN } from "../retry-tracker.js";

describe("RetryTracker", () => {
  it("synthesizes auto_retry_start on retryable assistant error", () => {
    const t = new RetryTracker();
    const ev = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "rate limit exceeded",
    });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_start");
    expect(ev!.data).toEqual({
      attempt: 1,
      maxAttempts: -1,
      delayMs: -1,
      errorMessage: "rate limit exceeded",
    });
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("does not synthesize for non-retryable error (e.g. context overflow)", () => {
    const t = new RetryTracker();
    const ev = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "prompt is too long: 300000 tokens > 200000 maximum",
    });
    expect(ev).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("does not synthesize for non-assistant messages", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "user" })).toBeNull();
    expect(t.observeMessageEnd("s1", { role: "toolResult", stopReason: "error" })).toBeNull();
  });

  it("does not synthesize for missing or empty errorMessage", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason: "error" })).toBeNull();
    expect(
      t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "" }),
    ).toBeNull();
  });

  it("increments attempt counter across multiple retryable errors", () => {
    const t = new RetryTracker();
    const a = t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    const b = t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    const c = t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    expect((a!.data as any).attempt).toBe(1);
    expect((b!.data as any).attempt).toBe(2);
    expect((c!.data as any).attempt).toBe(3);
  });

  it("synthesizes auto_retry_end success on successful assistant message_end after retry", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
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
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "rate limit" });
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

  it("synthesizes auto_retry_end success on agent_end with non-error terminal message", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
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
    t.noteAbort("s1");
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentEnd("s1", { messages: [] })).toBeNull();
  });

  it("scopes retry state per-session", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { role: "assistant", stopReason: "error", errorMessage: "429" });
    expect(t.isRetrying("s1")).toBe(true);
    expect(t.isRetrying("s2")).toBe(false);
  });

  it.each([
    "rate limit exceeded",
    "Rate Limit hit",
    "overloaded_error",
    "too many requests",
    "HTTP 429",
    "HTTP 500 Internal Server Error",
    "service unavailable",
    "fetch failed",
    "socket hang up",
    "connection refused",
    "connection lost",
    "request timed out",
    "terminated",
    "retry delay exceeded",
  ])("RETRYABLE_PATTERN matches: %s", (msg) => {
    expect(RETRYABLE_PATTERN.test(msg)).toBe(true);
  });

  it.each([
    "prompt is too long: 300000 tokens > 200000 maximum",
    "tool execution failed",
    "invalid input",
    "",
  ])("RETRYABLE_PATTERN does NOT match: %s", (msg) => {
    expect(RETRYABLE_PATTERN.test(msg)).toBe(false);
  });
});
