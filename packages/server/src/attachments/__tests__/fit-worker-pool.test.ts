import { Jimp, JimpMime } from "jimp";
import { describe, expect, it } from "vitest";
import { DISPLAY_MAX_EDGE } from "../display-fit.js";
import { createFitWorkerPool, workerExecArgv } from "../fit-worker-pool.js";
import { vi } from "vitest";

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

/**
 * E17/E18 — a worker keeps an inherited TS loader (native or jiti) and gets
 * the SELECTED loader only when none is present.
 * See change: fix-appimage-cold-boot-latency (design D4).
 */
describe("workerExecArgv", () => {
  const NATIVE = "file:///x/pi-dashboard-shared/src/platform/native-ts-register.mjs";
  const JITI = "file:///x/node_modules/jiti/lib/jiti-register.mjs";

  it("E17: an inherited native loader is kept unchanged; jiti never resolved", () => {
    const resolveJiti = vi.fn(() => JITI);
    const inherited = ["--import", NATIVE];
    expect(workerExecArgv("file:///w/fit-worker.ts", { execArgv: inherited, env: {}, resolveJiti })).toEqual(inherited);
    expect(resolveJiti).not.toHaveBeenCalled();
  });

  it("E18: no inherited loader → prepends the selected loader", () => {
    const deps = { execArgv: [], resolveJiti: () => JITI, resolveNative: () => NATIVE };
    expect(workerExecArgv("file:///w/fit-worker.ts", { ...deps, env: {} })).toEqual(["--import", NATIVE]);
    expect(workerExecArgv("file:///w/fit-worker.ts", { ...deps, env: { PI_DASHBOARD_TS_LOADER: "jiti" } })).toEqual(["--import", JITI]);
  });

  it("a native register that cannot be located returns the inherited argv (documented fallback), never throws", () => {
    const inherited = ["--max-old-space-size=512"];
    const resolveNative = () => { throw new Error("cannot locate native-ts-register.mjs"); };
    expect(workerExecArgv("file:///w/fit-worker.ts", { execArgv: inherited, env: {}, resolveNative })).toEqual(inherited);
  });

  it("E18: the default native locator yields a real register URL", () => {
    const argv = workerExecArgv("file:///w/fit-worker.ts", { execArgv: [], env: {} });
    expect(argv[0]).toBe("--import");
    expect(argv[1]).toMatch(/^file:\/\/.*\/platform\/native-ts-register\.mjs$/);
  });
});
