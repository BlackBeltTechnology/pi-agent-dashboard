import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp, JimpMime } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_EVENT_DATA_SIZE } from "../../persistence/memory-event-store.js";
import { startLagMonitor } from "../../test-support/event-loop-lag.js";
import { buildFittedEvent } from "../attachment-ingest.js";
import { DISPLAY_MAX_BYTES } from "../display-fit.js";
import { createFitWorkerPool } from "../fit-worker-pool.js";
import { findOriginalInTranscript } from "../original-store.js";

/** Default browser-gateway back-pressure ceiling (`browser-gateway.ts`). */
const MAX_WS_BUFFER = 4 * 1024 * 1024;
/**
 * test-plan #P1/#P2 budget — DERIVED, not chosen. See design.md D1.
 *
 *     healthy worker lag          1.1–11.9 ms   worker pool, single + burst
 *     worst observed contention   62.9 ms       failing full-suite `npm test`
 *     smallest regression signal  349 ms        in-process, single 2400x1600
 *
 * The budget must sit above contention and below the smallest regression, i.e.
 * inside `(62.9, 349)`. 200 ms clears contention by 3.2x and sits 1.75x below
 * the regression signal. The old 50 ms cleared contention by 0.8x — it was
 * BELOW the noise floor it had to clear, which is why it flaked.
 *
 * RE-DERIVATION RULE: if this gate flakes, do not nudge the number. Re-measure
 * all three anchors (procedure in design.md D3) and check the window is still
 * non-empty. A closed window means contention now overlaps the regression
 * signal, and the gate needs a different observable — not a bigger budget.
 */
const MAX_LAG_MS = 200;
/** Anchors of the D1 derivation; #E1/#E2 assert the window stays non-empty. */
const WORST_OBSERVED_CONTENTION_MS = 62.9;
const SMALLEST_REGRESSION_SIGNAL_MS = 349;
/**
 * A real offload regression is `workersDisabled = true` after a spawn failure,
 * which runs `size` concurrent ON-LOOP decodes. Production builds the pool with
 * `size: 2` (`server.ts`), while `fit-worker-pool.ts` defaults to 1 — so the
 * anti-vacuity check MUST set size explicitly. See design.md D4; #X2 guards it.
 */
const FALLBACK_POOL_OPTS = { useWorker: false, size: 2 } as const;

async function photoLikePng(w: number, h: number): Promise<string> {
  // Gradient + high-frequency detail: compresses like a real screenshot rather
  // than collapsing to nothing (a flat fill would make the test meaningless).
  const img = new Jimp({ width: w, height: h, color: 0x000000ff });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = (x * 255) / w;
      const g = (y * 255) / h;
      const b = ((x ^ y) & 0xff);
      img.setPixelColor(((((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8)) >>> 0) + 0xff, x, y);
    }
  }
  return (await img.getBuffer(JimpMime.png)).toString("base64");
}

describe("display-fit perf — event-loop offload (P1/P2)", () => {
  it("P1: fitting one large image keeps event-loop lag within budget", async () => {
    const data = await photoLikePng(2400, 1600);
    const pool = createFitWorkerPool({ size: 2 });
    // Let the worker spawn + jiti-compile BEFORE measuring: that cost is paid
    // once at boot in production, not per attachment, so folding it into the
    // per-fit budget would measure the wrong thing.
    await pool.fit({ blocks: [{ blockIndex: 0, data: await photoLikePng(80, 60), mimeType: "image/png" }] });

    const monitor = startLagMonitor(10);
    try {
      const out = await pool.fit({ blocks: [{ blockIndex: 0, data, mimeType: "image/png" }] });
      expect(out.results[0].fitted).toBe(true);
    } finally {
      var lag = monitor.stop();
      await pool.dispose();
    }
    expect(lag, `max event-loop lag ${lag.toFixed(1)}ms exceeded ${MAX_LAG_MS}ms`).toBeLessThan(
      MAX_LAG_MS,
    );
  }, 120_000);

  // CORRIGENDUM (design.md D5) — this test was previously skipped on the basis
  // of a measurement that has since been DISPROVEN. The archived record claimed
  // in-process fitting blocks the loop for ~0 ms because "jimp v1's async API
  // yields". Re-measured on this exact 5 x 1600x1200 burst, 3 runs:
  //
  //     in-process      wall 1419–2170 ms   max lag 1409–2160 ms
  //     worker (2)      wall 1164–1259 ms   max lag 1.1–11.9 ms
  //
  // The wall times reproduce; only the lag column did not. The old `0 ms` was a
  // pre-fix artifact of `event-loop-lag.ts` — without the final sample `stop()`
  // now takes, a continuously-blocking window reports 0. jimp v1 does NOT yield,
  // so the offload is justified by loop-blocking, and this scenario is a real
  // gate again: assert the worker-path burst against the same derived budget.
  it("P2: a concurrent burst of pastes keeps event-loop lag within budget", async () => {
    const blocks = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => ({
        blockIndex: i,
        data: await photoLikePng(1600, 1200),
        mimeType: "image/png",
      })),
    );

    const pool = createFitWorkerPool({ size: 2 });
    // Warm both slots before measuring — spawn + jiti compile is a boot cost.
    const warm = await photoLikePng(80, 60);
    await Promise.all([
      pool.fit({ blocks: [{ blockIndex: 0, data: warm, mimeType: "image/png" }] }),
      pool.fit({ blocks: [{ blockIndex: 1, data: warm, mimeType: "image/png" }] }),
    ]);

    const monitor = startLagMonitor(10);
    let lag: number;
    let outs: Awaited<ReturnType<typeof pool.fit>>[];
    try {
      outs = await Promise.all(blocks.map((b) => pool.fit({ blocks: [b] })));
    } finally {
      lag = monitor.stop();
      await pool.dispose();
    }

    for (const o of outs) expect(o.results[0].fitted).toBe(true);
    expect(lag, `max event-loop lag ${lag.toFixed(1)}ms exceeded ${MAX_LAG_MS}ms`).toBeLessThan(
      MAX_LAG_MS,
    );
  }, 300_000);
});

describe("display-fit perf — budget derivation window (E1/E2)", () => {
  it("E1: the budget sits strictly above the worst observed contention", () => {
    // The old 50 ms sat BELOW this floor (0.8x margin) — that is the flake.
    expect(MAX_LAG_MS).toBeGreaterThan(WORST_OBSERVED_CONTENTION_MS);
  });

  it("E2: the budget sits strictly below the smallest regression signal", () => {
    // Above this and the gate can no longer catch the regression it exists for.
    expect(MAX_LAG_MS).toBeLessThan(SMALLEST_REGRESSION_SIGNAL_MS);
  });
});

describe("display-fit perf — the lag gate is not vacuous (X1/X2)", () => {
  it("X1: a forced on-loop fallback blows the budget", async () => {
    const data = await photoLikePng(2400, 1600);
    const pool = createFitWorkerPool(FALLBACK_POOL_OPTS);
    // Warm the same way P1 does, so the two runs differ only in the offload.
    await pool.fit({
      blocks: [{ blockIndex: 0, data: await photoLikePng(80, 60), mimeType: "image/png" }],
    });

    const monitor = startLagMonitor(10);
    let lag: number;
    try {
      const out = await pool.fit({ blocks: [{ blockIndex: 0, data, mimeType: "image/png" }] });
      expect(out.results[0].fitted).toBe(true);
    } finally {
      lag = monitor.stop();
      await pool.dispose();
    }
    // Measured 349–416 ms. If this ever drops under the budget, P1 is passing
    // for free and the gate is asserting nothing.
    expect(
      lag,
      `on-loop fallback lag ${lag.toFixed(1)}ms did not exceed ${MAX_LAG_MS}ms — P1 is vacuous`,
    ).toBeGreaterThan(MAX_LAG_MS);
  }, 120_000);

  it("X2: the fallback anchor uses the production pool size, not the default", async () => {
    const serverSrc = await readFile(
      new URL("../../server.ts", import.meta.url),
      "utf8",
    );
    const match = serverSrc.match(/createFitWorkerPool\(\{\s*size:\s*(\d+)/);
    expect(match, "could not read the production pool size from server.ts").not.toBeNull();
    const productionSize = Number(match?.[1]);

    // A fallback modelled at the pool's default size 1 would anchor the check to
    // a workload production never runs (design.md D4).
    expect(FALLBACK_POOL_OPTS.size).toBe(productionSize);
    expect(FALLBACK_POOL_OPTS.size).toBeGreaterThan(1);
  });
});

describe("display-fit perf — broadcast payload (P3)", () => {
  it("P3: a fitted resolution frame is far below both the event ceiling and MAX_WS_BUFFER", async () => {
    const pool = createFitWorkerPool({ useWorker: false });
    const data = await photoLikePng(2400, 1600);
    const { results } = await pool.fit({ blocks: [{ blockIndex: 0, data, mimeType: "image/png" }] });
    await pool.dispose();

    const event = buildFittedEvent({
      attachmentId: "a".repeat(64),
      data: results[0].data,
      mimeType: results[0].mimeType,
      state: "ready",
    });
    const frameBytes = Buffer.byteLength(JSON.stringify(event), "utf8");

    expect(frameBytes).toBeLessThanOrEqual(DISPLAY_MAX_BYTES + 4_096); // payload + envelope
    expect(frameBytes).toBeLessThan(DEFAULT_MAX_EVENT_DATA_SIZE);
    // "≪ MAX_WS_BUFFER" — an order of magnitude of headroom, so a fitted frame
    // can never be the thing that trips back-pressure shedding.
    expect(frameBytes * 10).toBeLessThan(MAX_WS_BUFFER);
  }, 120_000);
});

describe("original-store perf — recovery streams rather than slurps (P4)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "orig-perf-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("P4: recovering from a large transcript stays well under its file size", async () => {
    const file = join(dir, "big.jsonl");
    writeFileSync(file, "");

    // ~40 MB of transcript: 16 entries carrying ~2.5 MB of base64 each. The
    // target is the LAST one, so the scan must traverse the whole file.
    const chunk = "Q".repeat(2_500_000);
    let targetData = "";
    for (let i = 0; i < 16; i++) {
      const data = `${chunk}${String.fromCharCode(97 + i)}`;
      if (i === 15) targetData = data;
      appendFileSync(
        file,
        JSON.stringify({
          type: "message",
          message: { role: "user", content: [{ type: "image", data, mimeType: "image/png" }] },
        }) + "\n",
      );
    }
    const targetId = createHash("sha256").update(targetData, "utf8").digest("hex");

    global.gc?.();
    const before = process.memoryUsage().rss;
    const found = await findOriginalInTranscript(file, targetId);
    const peakDelta = process.memoryUsage().rss - before;

    expect(found).not.toBeNull();
    // A slurping implementation would pull the whole ~40 MB (plus parse
    // overhead) into memory. Streaming line-by-line bounds the cost by the
    // LARGEST ENTRY, not the file.
    expect(
      peakDelta,
      `rss delta ${(peakDelta / 1e6).toFixed(1)}MB suggests the scan buffered the file`,
    ).toBeLessThan(50_000_000);
  }, 180_000);
});
