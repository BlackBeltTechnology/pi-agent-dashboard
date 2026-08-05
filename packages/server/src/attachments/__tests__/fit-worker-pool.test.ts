import { Jimp, JimpMime } from "jimp";
import { describe, expect, it } from "vitest";
import { DISPLAY_MAX_EDGE } from "../display-fit.js";
import { createFitWorkerPool } from "../fit-worker-pool.js";

async function oversizePng(): Promise<string> {
  const img = new Jimp({ width: 1600, height: 900, color: 0x2244aaff });
  return (await img.getBuffer(JimpMime.png)).toString("base64");
}

async function longEdgeOf(base64: string): Promise<number> {
  const img = await Jimp.read(Buffer.from(base64, "base64"));
  return Math.max(img.bitmap.width, img.bitmap.height);
}

describe("fit-worker-pool", () => {
  it("fits blocks on a real worker thread and returns them in order", async () => {
    const pool = createFitWorkerPool({ size: 1 });
    try {
      const data = await oversizePng();
      const out = await pool.fit({
        blocks: [
          { blockIndex: 0, data, mimeType: "image/png" },
          { blockIndex: 2, data, mimeType: "image/png" },
        ],
      });
      expect(out.results).toHaveLength(2);
      expect(out.results.map((r) => r.blockIndex)).toEqual([0, 2]);
      for (const r of out.results) {
        expect(r.fitted).toBe(true);
        expect(await longEdgeOf(r.data)).toBe(DISPLAY_MAX_EDGE);
      }
    } finally {
      await pool.dispose();
    }
  }, 30_000);

  it("X7: an unspawnable worker falls back in-process and still resolves", async () => {
    // A bogus entry URL makes `new Worker` throw, which must permanently
    // disable workers for this pool rather than lose the fit.
    const pool = createFitWorkerPool({
      size: 1,
      workerUrlOverride: "file:///nonexistent/definitely-not-a-worker.ts",
    });
    try {
      const data = await oversizePng();
      const out = await pool.fit({ blocks: [{ blockIndex: 0, data, mimeType: "image/png" }] });
      expect(out.results).toHaveLength(1);
      expect(out.results[0].fitted).toBe(true);
      expect(await longEdgeOf(out.results[0].data)).toBe(DISPLAY_MAX_EDGE);
    } finally {
      await pool.dispose();
    }
  }, 30_000);

  it("X8: a saturated pool queues without dropping or blocking a request", async () => {
    const pool = createFitWorkerPool({ size: 1 });
    try {
      const data = await oversizePng();
      // Five concurrent requests against a single slot: four must queue.
      const outs = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          pool.fit({ blocks: [{ blockIndex: i, data, mimeType: "image/png" }] }),
        ),
      );
      expect(outs).toHaveLength(5);
      for (const out of outs) {
        expect(out.results[0].fitted).toBe(true);
      }
      // Every job settled, so nothing is left in flight.
      expect(pool.inFlight()).toBe(0);
    } finally {
      await pool.dispose();
    }
  }, 60_000);

  it("useWorker:false runs entirely in-process", async () => {
    const pool = createFitWorkerPool({ useWorker: false });
    try {
      const data = await oversizePng();
      const out = await pool.fit({ blocks: [{ blockIndex: 0, data, mimeType: "image/png" }] });
      expect(out.results[0].fitted).toBe(true);
      expect(pool.inFlight()).toBe(0);
    } finally {
      await pool.dispose();
    }
  }, 30_000);

  it("X9: an undecodable block resolves failed without taking down siblings", async () => {
    const pool = createFitWorkerPool({ size: 1 });
    try {
      const good = await oversizePng();
      const out = await pool.fit({
        blocks: [
          { blockIndex: 0, data: Buffer.from("garbage").toString("base64"), mimeType: "image/png" },
          { blockIndex: 1, data: good, mimeType: "image/png" },
        ],
      });
      expect(out.results[0].failed).toBe(true);
      expect(out.results[1].fitted).toBe(true);
    } finally {
      await pool.dispose();
    }
  }, 30_000);
});
