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

    /** `normalize` off = the pre-change cost: no filesystem hit on the key. */
    function measure(pairs: number, normalize: boolean): number[] {
      const samples: number[] = [];
      for (let i = 0; i < pairs; i++) {
        const token = `tok_${normalize ? "n" : "b"}_${i}`;
        const started = performance.now();
        if (normalize) {
          w.arm({ cwd, mechanism: "headless", pid: 10_000 + i, spawnToken: token });
          w.clearByToken(token);
        } else {
          // Same map bookkeeping, no cwd normalization: the arm is keyed by a
          // path that cannot resolve, so `realpathSync` throws immediately
          // into the raw-string fallback.
          w.arm({ cwd: `${cwd}/nope-${i}`, mechanism: "headless", spawnToken: token });
          w.clearByToken(token);
        }
        samples.push(performance.now() - started);
      }
      return samples;
    }

    measure(200, true); // warm the JIT and the dentry cache
    const baseline = p95(measure(1_000, false));
    const withNormalization = p95(measure(1_000, true));

    expect(withNormalization - baseline).toBeLessThan(2);
    expect(withNormalization).toBeLessThan(20);
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
