/**
 * Unit tests for pending-resume-intent-registry.
 *
 * Uses an injectable `now()` to simulate the passage of time without
 * fake-timer infrastructure — keeps the tests synchronous and free of
 * implicit microtask ordering.
 *
 * See changes: preserve-session-order-on-reboot,
 *              differentiate-resume-intent-by-trigger.
 */
import { describe, it, expect } from "vitest";
import {
  createPendingResumeIntentRegistry,
  PENDING_RESUME_INTENT_TTL_MS,
} from "../pending/pending-resume-intent-registry.js";

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe("pending-resume-intent-registry", () => {
  it("record(\"front\") then consume returns \"front\"", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now });
    r.record("a", "front");
    expect(r.consume("a")).toBe("front");
  });

  it("record(\"keep\") then consume returns \"keep\"", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now });
    r.record("a", "keep");
    expect(r.consume("a")).toBe("keep");
  });

  it("consume clears the entry (second consume returns null)", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now });
    r.record("a", "front");
    r.consume("a");
    expect(r.consume("a")).toBeNull();
  });

  it("consume on an unknown id returns null (no error)", () => {
    const r = createPendingResumeIntentRegistry();
    expect(r.consume("unknown")).toBeNull();
  });

  it("record is idempotent — same id stored once", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now });
    r.record("a", "front");
    r.record("a", "front");
    r.record("a", "front");
    expect(r.size()).toBe(1);
    expect(r.consume("a")).toBe("front");
    expect(r.consume("a")).toBeNull();
  });

  it("re-record overwrites the prior intent (last-write-wins: front → keep)", () => {
    const r = createPendingResumeIntentRegistry();
    r.record("a", "front");
    r.record("a", "keep");
    expect(r.consume("a")).toBe("keep");
  });

  it("re-record overwrites the prior intent (last-write-wins: keep → front)", () => {
    const r = createPendingResumeIntentRegistry();
    r.record("a", "keep");
    r.record("a", "front");
    expect(r.consume("a")).toBe("front");
  });

  it("re-record refreshes the timestamp (resists expiry)", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now, ttlMs: 100 });
    r.record("a", "front");
    clock.advance(80);
    r.record("a", "front"); // refresh — would expire at t=180 from this point
    clock.advance(80); // total 160ms from first record, but only 80 since refresh
    expect(r.consume("a")).toBe("front");
  });

  it("consume returns null after TTL even without explicit consume", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now, ttlMs: 100 });
    r.record("a", "front");
    clock.advance(101);
    expect(r.consume("a")).toBeNull();
  });

  it("expired entry is dropped from storage", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now, ttlMs: 100 });
    r.record("a", "front");
    clock.advance(101);
    r.consume("a"); // returns null, drops the stale entry
    expect(r.size()).toBe(0);
  });

  it("size() prunes stale entries lazily", () => {
    const clock = makeClock();
    const r = createPendingResumeIntentRegistry({ now: clock.now, ttlMs: 100 });
    r.record("a", "front");
    r.record("b", "keep");
    clock.advance(50);
    r.record("c", "front");
    expect(r.size()).toBe(3);
    clock.advance(60); // a + b stale (110ms total), c still fresh (60ms)
    expect(r.size()).toBe(1);
  });

  it("multiple ids carry independent intents", () => {
    const r = createPendingResumeIntentRegistry();
    r.record("a", "front");
    r.record("b", "keep");
    r.record("c", "front");
    expect(r.consume("b")).toBe("keep");
    expect(r.consume("a")).toBe("front");
    expect(r.consume("c")).toBe("front");
    expect(r.size()).toBe(0);
  });

  it("empty/falsy sessionId is rejected on record and on consume", () => {
    const r = createPendingResumeIntentRegistry();
    r.record("", "front");
    expect(r.size()).toBe(0);
    expect(r.consume("")).toBeNull();
  });

  it("default TTL is 60s (sanity check exported constant)", () => {
    expect(PENDING_RESUME_INTENT_TTL_MS).toBe(60_000);
  });
});
