/**
 * Performance budgets for the derived-TTL / normalized-cwd work.
 *
 * P1 — cwd normalization adds a `realpathSync` at arm and at each clear, so the
 *      per-spawn arm+clear pair carries a filesystem hit that did not exist.
 * P2 — drop reporting sits on the inbound overflow path, a hot loop.
 * P3 — 5 000 spawns that never register must not retain correlation state.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan P1-P3).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));

import { createPendingClientCorrelations } from "../pending/pending-client-correlations.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";
import { SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

describe("spawn-correlation performance", () => {
  // P1 — 1 000 arm+clear pairs, p95 added wall-clock under 2ms per pair.
  it("keeps an arm+clear pair under 2ms at p95", () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-perf-"));
    const w = new SpawnRegisterWatchdog(120_000, {
      findPidsBySpawnToken: () => [],
      kill: () => {},
    });
    const samples: number[] = [];

    for (let i = 0; i < 1_000; i++) {
      const token = `tok_${i}`;
      const started = performance.now();
      w.arm({ cwd, mechanism: "headless", pid: 10_000 + i, spawnToken: token });
      w.clearByToken(token);
      samples.push(performance.now() - started);
    }

    expect(p95(samples)).toBeLessThan(2);
  });

  // P3 — 5 000 spawns at the maximum timeout, none registering: the map returns
  // to zero on its own TTLs, with a bounded RSS delta.
  it("returns the correlation map to zero after the derived TTL, without accumulating", () => {
    vi.useFakeTimers();
    try {
      const ttl = deriveSpawnCorrelationTtlMs(120_000);

      /** 5 000 spawns at the maximum timeout, none of which ever registers. */
      function cycle(): void {
        const correlations = createPendingClientCorrelations();
        for (let i = 0; i < 5_000; i++) correlations.record(`tok_${i}`, `req_${i}`, ttl);
        expect(correlations.size()).toBe(5_000);
        vi.advanceTimersByTime(ttl + 1);
        // Every entry evicted itself — nothing depends on a later consume.
        expect(correlations.size()).toBe(0);
        correlations.dispose();
      }

      // First cycle warms the allocator; RSS after it is the baseline. A leak
      // shows up as the SECOND identical cycle pushing RSS up again — measuring
      // the first cycle alone would just measure one-time growth, since RSS
      // never returns to the process's starting point.
      cycle();
      const baseline = process.memoryUsage().rss;
      cycle();
      expect(process.memoryUsage().rss - baseline).toBeLessThan(10 * 1024 * 1024);
    } finally {
      vi.useRealTimers();
    }
  });
});
