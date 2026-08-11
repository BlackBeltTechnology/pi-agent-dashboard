import { describe, expect, it } from "vitest";
import { createInitialState, type SessionState } from "../chat/event-reducer.js";
import { deriveRetryProjection } from "../session/retry-projection.js";

/**
 * The `retryState × lastError` matrix. The pre-change gate was
 * `state.retryState && !state.lastError`, which dropped the cell that actually
 * occurs during a provider retry (both set). See change: unify-retry-visibility.
 */
function state(over: Partial<SessionState>): SessionState {
  return { ...createInitialState(), ...over };
}

const retrying = (attempt: number) => ({
  attempt,
  maxAttempts: 20,
  delayMs: 2000,
  waiting: true,
  reason: "overloaded",
  startedAt: 0,
});

describe("deriveRetryProjection", () => {
  it("includes a session carrying BOTH retryState and lastError (the common case)", () => {
    const { retrySessionIds, retryAttemptMap } = deriveRetryProjection([
      ["s1", state({ retryState: retrying(3), lastError: { message: "503: overloaded_error", timestamp: 0 } })],
    ]);
    expect(retrySessionIds.has("s1")).toBe(true);
    expect(retryAttemptMap.get("s1")).toBe(3);
  });

  it("covers all four retryState × lastError cells", () => {
    const { retrySessionIds } = deriveRetryProjection([
      ["both", state({ retryState: retrying(2), lastError: { message: "boom", timestamp: 0 } })],
      ["retryOnly", state({ retryState: retrying(1) })],
      ["errorOnly", state({ lastError: { message: "boom", timestamp: 0 } })],
      ["neither", state({})],
    ]);
    expect([...retrySessionIds].sort()).toEqual(["both", "retryOnly"]);
  });

  it("publishes the attempt number per session, and nothing for non-retrying ones", () => {
    const { retryAttemptMap } = deriveRetryProjection([
      ["a", state({ retryState: retrying(1) })],
      ["b", state({ retryState: retrying(7), lastError: { message: "boom", timestamp: 0 } })],
      ["c", state({ lastError: { message: "boom", timestamp: 0 } })],
    ]);
    expect(retryAttemptMap.get("a")).toBe(1);
    expect(retryAttemptMap.get("b")).toBe(7);
    expect(retryAttemptMap.has("c")).toBe(false);
  });

  it("is empty for an empty session map", () => {
    const p = deriveRetryProjection([]);
    expect(p.retrySessionIds.size).toBe(0);
    expect(p.retryAttemptMap.size).toBe(0);
  });
});
