/**
 * Pending archive-intent registry (test-plan #E5, #E6).
 *
 * E5 — the intent must NOT survive its 60 s TTL: an `ended` that lands later
 * must not archive the session, and the registry must not leak the entry.
 * E6 — an explicit `clear()` (resume / turn start) discards the intent so a
 * later `ended` is an ordinary end.
 *
 * Uses fake timers so the real 60 s default TTL is exercised end to end.
 *
 * See change: archive-sessions-lazy-load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingArchiveIntentRegistry } from "../pending-archive-intent-registry.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 0, 1));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pending archive intent — one-shot semantics", () => {
  it("record then consume returns true", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");
    expect(registry.consume("s1")).toBe(true);
  });

  it("consume is one-shot — a second consume returns false", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");
    registry.consume("s1");
    expect(registry.consume("s1")).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("consume on an unknown id returns false", () => {
    const registry = createPendingArchiveIntentRegistry();
    expect(registry.consume("nope")).toBe(false);
  });

  it("intents for different ids are independent", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");
    registry.record("s2");
    expect(registry.consume("s1")).toBe(true);
    expect(registry.size()).toBe(1);
    expect(registry.consume("s2")).toBe(true);
  });
});

describe("pending archive intent expiry (E5)", () => {
  it("does not archive after the 60 s TTL elapses", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");

    vi.advanceTimersByTime(60_001);

    expect(registry.consume("s1")).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it("still archives just inside the TTL", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");

    vi.advanceTimersByTime(59_999);

    expect(registry.consume("s1")).toBe(true);
  });

  it("size() prunes an expired entry without consuming it", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");
    vi.advanceTimersByTime(30_000);
    registry.record("s2");

    expect(registry.size()).toBe(2);

    vi.advanceTimersByTime(31_000); // s1 is 61 s old, s2 only 31 s
    expect(registry.size()).toBe(1);
    expect(registry.consume("s2")).toBe(true);
  });
});

describe("pending archive intent clearing (E6)", () => {
  it("clear() discards the intent — a later ended does not archive", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");

    registry.clear("s1");

    expect(registry.size()).toBe(0);
    expect(registry.consume("s1")).toBe(false);
  });

  it("clear() on an unknown id is a no-op", () => {
    const registry = createPendingArchiveIntentRegistry();
    registry.record("s1");
    registry.clear("other");
    expect(registry.consume("s1")).toBe(true);
  });
});
