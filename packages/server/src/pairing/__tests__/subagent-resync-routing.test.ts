/**
 * C5 — a resync reply is delivered to the REQUESTER, not fanned out to every
 * subscriber of the session. Pre-existing behaviour, newly load-bearing once a
 * mounted inspector pulls on a cadence: N viewers of one session used to
 * multiply every reply by N.
 *
 * See change: reduce-subagent-details-payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESYNC_REQUEST_TTL_MS,
  ResyncRequesterRegistry,
  resyncRequestIdOf,
} from "../subagent-resync-routing.js";

describe("resyncRequestIdOf", () => {
  it("reads the correlation token off a reply frame", () => {
    expect(resyncRequestIdOf({ id: "ag1", __resyncRequestId: "r1" })).toBe("r1");
  });

  it("is undefined for an ordinary frame or a malformed token", () => {
    expect(resyncRequestIdOf({ id: "ag1" })).toBeUndefined();
    expect(resyncRequestIdOf(undefined)).toBeUndefined();
    expect(resyncRequestIdOf({ __resyncRequestId: 42 })).toBeUndefined();
    expect(resyncRequestIdOf({ __resyncRequestId: "" })).toBeUndefined();
  });
});

describe("ResyncRequesterRegistry", () => {
  const ws1 = { id: 1 };
  const ws2 = { id: 2 };
  let registry: ResyncRequesterRegistry<typeof ws1>;

  beforeEach(() => {
    registry = new ResyncRequesterRegistry<typeof ws1>();
  });

  it("returns the requesting connection exactly once", () => {
    registry.record("r1", ws1, 1_000);
    expect(registry.take("r1", 1_100)).toBe(ws1);
    // Consumed: a duplicate reply must not be routed a second time.
    expect(registry.take("r1", 1_100)).toBeUndefined();
  });

  it("keeps requesters distinct", () => {
    registry.record("r1", ws1, 1_000);
    registry.record("r2", ws2, 1_000);
    expect(registry.take("r2", 1_000)).toBe(ws2);
    expect(registry.take("r1", 1_000)).toBe(ws1);
  });

  it("expires an unanswered request rather than leaking it", () => {
    registry.record("r1", ws1, 1_000);
    expect(registry.take("r1", 1_000 + RESYNC_REQUEST_TTL_MS + 1)).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it("prunes expired entries when new ones arrive, staying bounded", () => {
    for (let i = 0; i < 50; i++) registry.record(`r${i}`, ws1, 1_000);
    expect(registry.size).toBe(50);
    registry.record("late", ws2, 1_000 + RESYNC_REQUEST_TTL_MS + 1);
    expect(registry.size).toBe(1);
    expect(registry.take("late", 1_000 + RESYNC_REQUEST_TTL_MS + 1)).toBe(ws2);
  });

  it("never grows past its hard cap even with no expiry", () => {
    const small = new ResyncRequesterRegistry<typeof ws1>(4);
    for (let i = 0; i < 10; i++) small.record(`r${i}`, ws1, 1_000);
    expect(small.size).toBeLessThanOrEqual(4);
    // The most recent request survives; the oldest were dropped.
    expect(small.take("r9", 1_000)).toBe(ws1);
    expect(small.take("r0", 1_000)).toBeUndefined();
  });

  it("drops every pending request of a disconnected connection", () => {
    registry.record("r1", ws1, 1_000);
    registry.record("r2", ws2, 1_000);
    registry.forget(ws1);
    expect(registry.take("r1", 1_000)).toBeUndefined();
    expect(registry.take("r2", 1_000)).toBe(ws2);
  });

  it("an unknown token routes nowhere (caller falls back to broadcast)", () => {
    expect(registry.take("never-seen", Date.now())).toBeUndefined();
  });

  it("defaults its clock to Date.now()", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    registry.record("r1", ws1);
    expect(registry.take("r1")).toBe(ws1);
    now.mockRestore();
  });
});

describe("ResyncRequesterRegistry.peek — non-consuming lookup (prompt-resync replies)", () => {
  /**
   * Prompt-resync replies (fix-pending-prompt-lost-on-replay, design D5): a
   * bridge re-emits EVERY pending prompt under one token, so the prompt path
   * must resolve the requester repeatedly. `take` stays take-once for
   * subagent event replies — the two semantics live side by side.
   */
  const ws1 = { id: 1 };
  let registry: ResyncRequesterRegistry<typeof ws1>;

  beforeEach(() => {
    registry = new ResyncRequesterRegistry<typeof ws1>();
  });

  it("E7: one token serves two (or more) replies without consuming the token", () => {
    registry.record("r1", ws1, 1_000);
    expect(registry.peek("r1", 1_100)).toBe(ws1);
    expect(registry.peek("r1", 1_200)).toBe(ws1);
    expect(registry.size).toBe(1);
    // `take` is untouched for subagent events: still consume-once.
    expect(registry.take("r1", 1_300)).toBe(ws1);
    expect(registry.peek("r1", 1_300)).toBeUndefined();
  });

  it("E8: TTL boundary — live at t0+29.9 s, expired at t0+30.1 s", () => {
    registry.record("r1", ws1, 1_000);
    expect(registry.peek("r1", 1_000 + 29_900)).toBe(ws1);
    expect(registry.peek("r1", 1_000 + 30_100)).toBeUndefined();
  });

  it("E9: a forgotten connection is no longer resolvable and the size returns to 0", () => {
    registry.record("r1", ws1, 1_000);
    registry.forget(ws1);
    expect(registry.size).toBe(0);
    expect(registry.peek("r1", 1_000)).toBeUndefined();
  });

  it("X3: an unknown token peeks undefined (caller falls back to fan-out)", () => {
    expect(registry.peek("never-seen", Date.now())).toBeUndefined();
  });

  it("peek never deletes: an expired peek leaves the entry for the pruners", () => {
    registry.record("r1", ws1, 1_000);
    // Expired → undefined, but the entry itself stays until record()/forget()
    // prune it — peek must not mutate the map.
    expect(registry.peek("r1", 1_000 + RESYNC_REQUEST_TTL_MS + 100)).toBeUndefined();
    expect(registry.size).toBe(1);
    expect(registry.take("r1", 1_000)).toBe(ws1); // still there for take
  });
});
