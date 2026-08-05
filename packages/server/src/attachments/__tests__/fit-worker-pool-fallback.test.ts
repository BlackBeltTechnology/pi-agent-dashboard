/**
 * In-process fallback concurrency (CodeRabbit round 2).
 *
 * When workers are disabled or unspawnable, every fit runs on the MAIN thread.
 * Unbounded, a burst of pastes runs N simultaneous jimp decodes there — the
 * exact event-loop stall the worker pool exists to prevent, and a cheap DoS.
 * The fallback must respect the same slot count as the worker path.
 *
 * Lives in its own file because it mocks `fit-worker.js` to observe
 * concurrency; the sibling suite needs the real implementation.
 */
import { describe, expect, it, vi } from "vitest";
import type { FitRequest, FitResponse } from "../fit-worker.js";

let active = 0;
let peak = 0;
const release: Array<() => void> = [];

vi.mock("../fit-worker.js", () => ({
  fitBlocks: async (req: FitRequest): Promise<FitResponse> => {
    active++;
    peak = Math.max(peak, active);
    // Park until the test explicitly lets this fit finish, so every admitted
    // job is provably in-flight at the same moment.
    await new Promise<void>((r) => release.push(r));
    active--;
    return { jobId: req.jobId, results: [] };
  },
}));

const { createFitWorkerPool } = await import("../fit-worker-pool.js");

describe("fit-worker-pool in-process fallback", () => {
  it("never runs more concurrent in-process fits than the pool size", async () => {
    active = 0;
    peak = 0;
    release.length = 0;

    const pool = createFitWorkerPool({ useWorker: false, size: 2 });
    const jobs = Array.from({ length: 8 }, (_, i) =>
      pool.fit({ blocks: [{ blockIndex: i, data: "AAAA", mimeType: "image/png" }] }),
    );

    // Let every admitted fit start, then drain them one at a time.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setImmediate(r));
      expect(active).toBeLessThanOrEqual(2);
      release.shift()?.();
    }
    while (release.length > 0) release.shift()?.();

    await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1); // the cap is a cap, not a serializer
    await pool.dispose();
  }, 30_000);

  it("dispose settles the backlog WITHOUT running fits during shutdown", async () => {
    // `dispose()` used to hand every queued job to `fallbackSettle`, i.e. start
    // real jimp decodes on the main thread while the server was shutting down.
    // Shutdown must abandon pending work, not perform it.
    active = 0;
    peak = 0;
    release.length = 0;

    const pool = createFitWorkerPool({ useWorker: false, size: 1 });
    const jobs = Array.from({ length: 5 }, (_, i) =>
      pool.fit({ blocks: [{ blockIndex: i, data: "AAAA", mimeType: "image/png" }] }),
    );
    await new Promise((r) => setImmediate(r)); // let the first job occupy the slot

    const started = peak;
    await pool.dispose();
    while (release.length > 0) release.shift()?.();

    // Every caller is answered — dispose must not strand a promise.
    const out = await Promise.all(jobs);
    expect(out).toHaveLength(5);
    // and no ADDITIONAL fit was started by dispose itself.
    expect(peak).toBe(started);
  }, 30_000);

  it("still settles every queued fit once the backlog drains", async () => {
    active = 0;
    peak = 0;
    release.length = 0;

    const pool = createFitWorkerPool({ useWorker: false, size: 1 });
    const jobs = Array.from({ length: 5 }, (_, i) =>
      pool.fit({ blocks: [{ blockIndex: i, data: "AAAA", mimeType: "image/png" }] }),
    );

    const drain = setInterval(() => release.shift()?.(), 0);
    const out = await Promise.all(jobs);
    clearInterval(drain);

    expect(out).toHaveLength(5); // nothing is dropped by the cap
    expect(peak).toBe(1);
    await pool.dispose();
  }, 30_000);
});
