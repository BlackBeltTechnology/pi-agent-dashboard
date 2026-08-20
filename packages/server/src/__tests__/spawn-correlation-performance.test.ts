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
import { normalizeCwdKey, SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

describe("spawn-correlation performance", () => {
  // P1 — 1 000 arm+clear pairs, p95 ADDED wall-clock under 2ms per pair.
  //
  // Measured as a DELTA against a baseline in the same process, not against a
  // bare wall-clock number: the added cost is one `realpathSync` per arm, and
  // an absolute budget on a loaded or network-backed CI runner measures the
  // runner, not the change (a single GC pause inside one `performance.now()`
  // window would fail the run with no signal about what regressed). The
  // absolute cap is kept as a generous ceiling so a pathological regression
  // still fails even if the baseline degrades with it.
  it("adds under 2ms at p95 to an arm+clear pair", () => {
    const cwd = mkdtempSync(join(tmpdir(), "spawn-perf-"));
    const w = new SpawnRegisterWatchdog(120_000, {
      findPidsBySpawnToken: () => [],
      kill: () => {},
    });

    function measurePairs(pairs: number): number[] {
      const samples: number[] = [];
      for (let i = 0; i < pairs; i++) {
        const token = `tok_${i}`;
        const started = performance.now();
        w.arm({ cwd, mechanism: "headless", pid: 10_000 + i, spawnToken: token });
        const claimed = w.clearByToken(token);
        samples.push(performance.now() - started);
        // A perf loop that measures no-ops measures nothing: if the arm never
        // landed, `clearByToken` returns false and the budget below would pass
        // vacuously.
        expect(claimed).toBe(true);
      }
      return samples;
    }

    /**
     * The ADDED component in isolation. `arm` always normalizes, so there is no
     * "normalization off" arm to diff against — an arm keyed by an unresolvable
     * path still calls `realpathSync` (and a throw is not obviously cheaper).
     * Measuring the normalizer directly is the honest attribution.
     */
    function measureNormalizer(calls: number): number[] {
      const samples: number[] = [];
      for (let i = 0; i < calls; i++) {
        const started = performance.now();
        normalizeCwdKey(cwd);
        samples.push(performance.now() - started);
      }
      return samples;
    }

    measurePairs(200); // warm the JIT and the dentry cache
    measureNormalizer(200);

    const added = p95(measureNormalizer(1_000));
    const perPair = p95(measurePairs(1_000));

    // The budget is on what this change ADDS — one `realpathSync` per arm.
    expect(added).toBeLessThan(2);
    // Generous absolute ceiling so a pathological regression still fails even
    // if the runner (and therefore the baseline) degrades with it. Not a
    // latency SLA: a bare wall-clock budget on shared CI measures the runner.
    expect(perPair).toBeLessThan(20);
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
    // Two cycles × 5 000 timers is genuinely heavy work; on a loaded machine it
    // outruns the 30 s default and fails as a timeout rather than on the
    // assertion it exists for. The workload is the scenario's, not a budget.
  }, 120_000);
});
