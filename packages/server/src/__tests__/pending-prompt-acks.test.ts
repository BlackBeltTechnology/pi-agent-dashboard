/**
 * Pending prompt acknowledgements: bounded twice — by the derived window and by
 * the session unregistering — and never claimable by a displaced connection.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E34, E35, X9, X10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingPromptAcks } from "../pending/pending-prompt-acks.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";

describe("pendingPromptAcks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acknowledges a transmitted prompt exactly once", () => {
    const acks = createPendingPromptAcks();
    acks.record("p1", "S1", deriveSpawnCorrelationTtlMs(30_000));
    expect(acks.isPending("p1")).toBe(true);
    expect(acks.acknowledge("p1", "S1")).toBe(true);
    expect(acks.acknowledge("p1", "S1")).toBe(false);
    acks.dispose();
  });

  // E34 — evicted on the same derived window as the correlations.
  it("evicts an unacknowledged prompt once the derived window elapses", () => {
    const acks = createPendingPromptAcks();
    acks.record("p1", "S1", deriveSpawnCorrelationTtlMs(30_000));
    vi.advanceTimersByTime(94_999);
    expect(acks.isPending("p1")).toBe(true);
    vi.advanceTimersByTime(2);
    expect(acks.isPending("p1")).toBe(false);
    expect(acks.acknowledge("p1", "S1")).toBe(false);
    acks.dispose();
  });

  // E35 — and immediately when the session goes away.
  it("evicts every pending prompt for a session that unregisters", () => {
    const acks = createPendingPromptAcks();
    const ttl = deriveSpawnCorrelationTtlMs(30_000);
    acks.record("p1", "S1", ttl);
    acks.record("p2", "S1", ttl);
    acks.record("p3", "S2", ttl);

    expect(acks.evictSession("S1")).toBe(2);
    expect(acks.isPending("p1")).toBe(false);
    expect(acks.isPending("p2")).toBe(false);
    expect(acks.isPending("p3")).toBe(true);
    acks.dispose();
  });

  // X9 — an ack naming another session's prompt cannot claim it.
  it("refuses an acknowledgement from a different session", () => {
    const acks = createPendingPromptAcks();
    acks.record("p1", "S1", deriveSpawnCorrelationTtlMs(30_000));
    expect(acks.acknowledge("p1", "S_other")).toBe(false);
    expect(acks.isPending("p1")).toBe(true);
    acks.dispose();
  });

  // X10 — a bridge that never acks: the prompt simply stays transmitted and the
  // state is still reclaimed. Nothing fails.
  it("leaves a never-acknowledged prompt harmlessly pending until eviction", () => {
    const acks = createPendingPromptAcks();
    acks.record("p1", "S1", deriveSpawnCorrelationTtlMs(120_000));
    vi.advanceTimersByTime(185_001);
    expect(acks.size()).toBe(0);
    acks.dispose();
  });

  it("records nothing on a non-positive TTL", () => {
    const acks = createPendingPromptAcks();
    acks.record("p1", "S1", 0);
    expect(acks.size()).toBe(0);
    acks.dispose();
  });

  // Review finding: the TTL and the unregister sweep bound each entry's
  // LIFETIME, not the COUNT. A prompt loop must not grow the map without limit.
  it("caps in-flight acks per session, dropping the oldest", () => {
    const acks = createPendingPromptAcks();
    const ttl = deriveSpawnCorrelationTtlMs(120_000);
    for (let i = 0; i < 200; i++) acks.record(`p${i}`, "S1", ttl);

    expect(acks.size()).toBeLessThanOrEqual(64);
    // The newest is retained, the oldest is gone.
    expect(acks.isPending("p199")).toBe(true);
    expect(acks.isPending("p0")).toBe(false);
    acks.dispose();
  });

  it("caps per session, so a busy session cannot evict another's acks", () => {
    const acks = createPendingPromptAcks();
    const ttl = deriveSpawnCorrelationTtlMs(30_000);
    acks.record("quiet", "S_quiet", ttl);
    for (let i = 0; i < 200; i++) acks.record(`busy${i}`, "S_busy", ttl);

    expect(acks.isPending("quiet")).toBe(true);
    expect(acks.acknowledge("quiet", "S_quiet")).toBe(true);
    acks.dispose();
  });
});
