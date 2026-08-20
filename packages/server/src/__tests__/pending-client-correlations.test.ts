/**
 * Derived correlation TTL: the entry must outlive the watchdog armed for the
 * same spawn, at every configured timeout.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E1-E6).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingClientCorrelations } from "../pending/pending-client-correlations.js";
import {
  deriveSpawnCorrelationTtlMs,
  ORDERING_MARGIN_MS,
  RECOVERY_GRACE_MS,
} from "../spawn-process/spawn-recovery-window.js";

describe("pendingClientCorrelations — TTL derived from the arming timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // E1
  it("timeout 30_000 → TTL 95_000, not 60_000", () => {
    expect(deriveSpawnCorrelationTtlMs(30_000)).toBe(95_000);
    expect(deriveSpawnCorrelationTtlMs(30_000)).not.toBe(60_000);
  });

  // E2 — lower clamp bound; the recovery window itself is NOT shrunk.
  it("timeout at the lower bound 5_000 → TTL 70_000, recovery window still 60_000", () => {
    expect(deriveSpawnCorrelationTtlMs(5_000)).toBe(70_000);
    expect(RECOVERY_GRACE_MS).toBe(60_000);
    expect(ORDERING_MARGIN_MS).toBe(5_000);
  });

  // E3 — upper clamp bound.
  it("timeout at the upper bound 120_000 → TTL 185_000", () => {
    expect(deriveSpawnCorrelationTtlMs(120_000)).toBe(185_000);
  });

  // E4 — a register just inside the window still resolves.
  it("recorded at t=0 with timeout 90_000 → still resolvable at t+89_999ms", () => {
    const reg = createPendingClientCorrelations();
    reg.record("tok", "req-1", deriveSpawnCorrelationTtlMs(90_000));
    vi.advanceTimersByTime(89_999);
    expect(reg.consume("tok")).toBe("req-1");
    reg.dispose();
  });

  // E5 — and is evicted by its own TTL afterwards.
  it("recorded at t=0 with timeout 90_000 → evicted at t+155_001ms", () => {
    const reg = createPendingClientCorrelations();
    reg.record("tok", "req-1", deriveSpawnCorrelationTtlMs(90_000));
    vi.advanceTimersByTime(155_001);
    expect(reg.consume("tok")).toBeUndefined();
    reg.dispose();
  });

  // E6 — static: no literal governs entry expiry any more.
  it("the module exposes no hardcoded governing TTL constant", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../pending/pending-client-correlations.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).not.toMatch(/DEFAULT_TTL_MS/);
    expect(src).not.toMatch(/60_000|60000/);
  });

  it("record without a TTL is a no-op rather than an undated entry", () => {
    const reg = createPendingClientCorrelations();
    reg.record("tok", "req-1", 0);
    expect(reg.size()).toBe(0);
    reg.dispose();
  });
});
