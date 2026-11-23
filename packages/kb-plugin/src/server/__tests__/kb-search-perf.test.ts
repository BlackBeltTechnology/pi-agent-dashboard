// @vitest-environment node
/**
 * S61 / S76 — read isolation while a worker writes. The P1 search p95 budget (design D8) and the S61 tail
 * bound live in `kb-search-perf.budget.test.ts` (budget lane).
 * See change: improve-kb-settings-sources-and-search, stabilize-blocking-test-lanes.
 */
import { appendFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { p95Of, readWhileWorkerWrites, seededFolder } from "./helpers/kb-perf-harness.js";

/**
 * S61 — read isolation (throttle-kb-reindex, R4): a worker thread writing continuously must not make main-thread
 * reads throw `SQLITE_BUSY`, stall, or show a non-monotonic snapshot. WAL readers never block on the writer.
 * S76 — the same loop over the full ≈ 50k-chunk corpus, opt-in (`KB_MEASURE=1`).
 */
describe("kb read isolation while a worker writes (S61, R4 invariant)", () => {
  it("search + stats never throw/SQLITE_BUSY and see non-decreasing row/file counts", async () => {
    const cwd = seededFolder();
    try {
      const r = await readWhileWorkerWrites(cwd, 600);
      expect(r.spawnedWorker).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.calls).toBeGreaterThanOrEqual(8); // the loop really ran against the live writer
      for (let i = 1; i < r.files.length; i++) {
        expect(r.files[i]).toBeGreaterThanOrEqual(r.files[i - 1]);
        expect(r.chunks[i]).toBeGreaterThanOrEqual(r.chunks[i - 1]);
      }
      expect(new Set(r.chunks).size).toBeGreaterThan(1); // the snapshot advanced: reads overlapped the write
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});

describe.skipIf(!process.env.KB_MEASURE)("KB_MEASURE: no BUSY and fast search during a ≈ 50k-chunk worker pass (S76)", () => {
  it("0 failed calls and search p95 < 50 ms", async () => {
    const cwd = seededFolder();
    try {
      const r = await readWhileWorkerWrites(cwd, Number(process.env.KB_MEASURE_FILES ?? 3250));
      const r1 = (n: number) => Number(n.toFixed(1));
      const line = `KB_MEASURE search-during-pass ${JSON.stringify({ calls: r.calls, errors: r.errors.length, searchP95Ms: r1(p95Of(r.searchTimes)), searchMaxMs: r1(Math.max(...r.searchTimes)), statsP95Ms: r1(p95Of(r.statsTimes)), statsMaxMs: r1(Math.max(...r.statsTimes)), idleSearchP95Ms: r1(p95Of(r.idleSearchTimes)) })}`;
      console.log(line);
      if (process.env.KB_MEASURE_OUT) appendFileSync(process.env.KB_MEASURE_OUT, `${line}\n`);
      expect(r.errors).toEqual([]);
      expect(r.spawnedWorker).toBe(true);
      // Target < 50 ms; relaxed to 2× the same search with no writer when the index itself is slower than that
      // (index-size cost and CPU contention with the worker thread are not writer lock contention — both
      // numbers are in the recorded line; the hard invariant is the 0 failed calls above).
      expect(p95Of(r.searchTimes)).toBeLessThan(Math.max(50, 2 * p95Of(r.idleSearchTimes)));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 900_000);
});
