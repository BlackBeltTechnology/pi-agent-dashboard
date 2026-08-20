import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";

/** TTL a fork armed at the DEFAULT spawn-register timeout now carries. */
const TTL_DEFAULT = deriveSpawnCorrelationTtlMs(30_000);

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
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    const result = reg.consumeFork("tok_a");
    expect(result).toBe("parent-1");
  });

  it("returns undefined when no fork pending", () => {
    const reg = createPendingForkRegistry();
    expect(reg.consumeFork("tok_unknown")).toBeUndefined();
  });

  it("consume clears the entry", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    reg.consumeFork("tok_a");
    expect(reg.consumeFork("tok_a")).toBeUndefined();
  });

  // E10 — at the default timeout the old hardcoded 30_000 made this a coin-flip.
  it("at the default timeout, still consumable at t+29_000ms", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    vi.advanceTimersByTime(29_000);
    expect(reg.consumeFork("tok_a")).toBe("parent-1");
  });

  // E11 — a raised timeout widens the fork window with it.
  it("at timeout 90_000, still consumable at t+70_000ms", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", deriveSpawnCorrelationTtlMs(90_000));
    vi.advanceTimersByTime(70_000);
    expect(reg.consumeFork("tok_a")).toBe("parent-1");
  });

  it("expires once its derived TTL elapses", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    vi.advanceTimersByTime(TTL_DEFAULT + 1);
    expect(reg.consumeFork("tok_a")).toBeUndefined();
  });

  it("does not expire just before its derived TTL", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    vi.advanceTimersByTime(TTL_DEFAULT - 1);
    expect(reg.consumeFork("tok_a")).toBe("parent-1");
  });

  it("a non-positive TTL records nothing rather than an entry that never expires", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", 0);
    expect(reg.consumeFork("tok_a")).toBeUndefined();
  });

  it("re-recording with same token replaces parent", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-1", TTL_DEFAULT);
    reg.recordFork("tok_a", "parent-2", TTL_DEFAULT);
    expect(reg.consumeFork("tok_a")).toBe("parent-2");
  });

  it("different tokens are independent", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-a", TTL_DEFAULT);
    reg.recordFork("tok_b", "parent-b", TTL_DEFAULT);
    expect(reg.consumeFork("tok_a")).toBe("parent-a");
    expect(reg.consumeFork("tok_b")).toBe("parent-b");
  });

  it("multi-fork-in-same-cwd: each fork keyed by its own token, no overwrite", () => {
    // Regression: the prior cwd-keyed registry would overwrite the first
    // fork's parent when a second fork issued in the same cwd recorded
    // its intent before the first's bridge registered. Token-keying
    // makes the two intents independent.
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_fork1", "parent-A", TTL_DEFAULT);
    reg.recordFork("tok_fork2", "parent-B", TTL_DEFAULT);
    // Bridge connect order can be reversed:
    expect(reg.consumeFork("tok_fork2")).toBe("parent-B");
    expect(reg.consumeFork("tok_fork1")).toBe("parent-A");
  });

  it("dispose clears all timers", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("tok_a", "parent-a", TTL_DEFAULT);
    reg.recordFork("tok_b", "parent-b", TTL_DEFAULT);
    reg.dispose();
    expect(reg.consumeFork("tok_a")).toBeUndefined();
    expect(reg.consumeFork("tok_b")).toBeUndefined();
  });

  it("empty token is rejected on record", () => {
    const reg = createPendingForkRegistry();
    reg.recordFork("", "parent-1", TTL_DEFAULT);
    expect(reg.consumeFork("")).toBeUndefined();
  });
});
