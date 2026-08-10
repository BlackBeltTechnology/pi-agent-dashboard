import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";

// See change: spawn-correlation-token \u2014 registry is now keyed by spawnToken
// (UUID minted by the server per spawn invocation) instead of cwd. This
// closes the multi-fork-in-same-cwd race where the second `recordFork`
// would overwrite the first's parentSessionId.

describe("PendingForkRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records and consumes a fork by token", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1");
    const result = reg.consumeFork("tok_a");
    expect(result).toBe("parent-1");
  });

  it("returns undefined when no fork pending", () => {
    const reg = createPendingForkRegistry();
    expect(reg.consumeFork("tok_unknown")).toBeUndefined();
  });

  it("consume clears the entry", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1");
    reg.consumeFork("tok_a");
    expect(reg.consumeFork("tok_a")).toBeUndefined();
  });

  it("expires after 30 seconds", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1");
    vi.advanceTimersByTime(30_001);
    expect(reg.consumeFork("tok_a")).toBeUndefined();
  });

  it("does not expire before 30 seconds", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1");
    vi.advanceTimersByTime(29_999);
    expect(reg.consumeFork("tok_a")).toBe("parent-1");
  });

  it("re-recording with same token replaces parent", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1");
    reg.recordFork("tok_a", "parent-2");
    expect(reg.consumeFork("tok_a")).toBe("parent-2");
  });

  it("different tokens are independent", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-a");
    reg.recordFork("tok_b", "parent-b");
    expect(reg.consumeFork("tok_a")).toBe("parent-a");
    expect(reg.consumeFork("tok_b")).toBe("parent-b");
  });

  it("multi-fork-in-same-cwd: each fork keyed by its own token, no overwrite", () => {
    // Regression: the prior cwd-keyed registry would overwrite the first
    // fork's parent when a second fork issued in the same cwd recorded
    // its intent before the first's bridge registered. Token-keying
    // makes the two intents independent.
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_fork1", "parent-A");
    reg.recordFork("tok_fork2", "parent-B");
    // Bridge connect order can be reversed:
    expect(reg.consumeFork("tok_fork2")).toBe("parent-B");
    expect(reg.consumeFork("tok_fork1")).toBe("parent-A");
  });

  it("dispose clears all timers", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-a");
    reg.recordFork("tok_b", "parent-b");
    reg.dispose();
    expect(reg.consumeFork("tok_a")).toBeUndefined();
    expect(reg.consumeFork("tok_b")).toBeUndefined();
  });

  it("empty token is rejected on record", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("", "parent-1");
    expect(reg.consumeFork("")).toBeUndefined();
  });
});
