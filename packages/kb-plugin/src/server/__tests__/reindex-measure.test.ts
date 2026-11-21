// @vitest-environment node
/**
 * Opt-in worker-mode measurement (change: throttle-kb-reindex, tasks 4.58/4.59/4.61; test-plan #S73/#S74).
 * `KB_MEASURE=1 npx vitest run reindex-measure` in packages/kb-plugin — NOT part of default `npm test`.
 *
 * One forced first-index pass over the task-1.1 corpus (≈ 51k chunks) on a real reindex worker, driven through
 * `reindexAll` on the main thread; the main thread's event-loop delay is sampled over the whole pass
 * (`withEventLoopLag`, same probe as the kb baseline) and the wall time compared with the recorded in-process
 * baseline (design.md `## Measurements`: 66.8–70.9 s, max lag 4.7–5.1 s).
 *
 * Env: KB_MEASURE_OUT (file to append the JSON result to; vitest may swallow console output),
 * KB_MEASURE_FILES (default 3250 files ⇒ 3000 indexed, ≈ 51k chunks), KB_MEASURE_BASELINE_MS (in-process
 * wall to compare against; default = the slower recorded baseline, applied only to the default corpus size).
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withEventLoopLag } from "../../../../kb/src/__tests__/helpers/event-loop-lag.js";
import { buildReindexCorpus } from "../../../../kb/src/__tests__/helpers/reindex-corpus.js";
import { reindexAll } from "../kb-routes.js";
import { createReindexRunner } from "../reindex-runner.js";

const DEFAULT_FILES = 3250;
const RECORDED_BASELINE_MS = 70_893; // design.md `## Measurements`, baseline #2 (in-process, current code)
const LAG_TARGET_MS = 200;
const files = Number(process.env.KB_MEASURE_FILES ?? DEFAULT_FILES);
const baselineMs = Number(process.env.KB_MEASURE_BASELINE_MS ?? (files === DEFAULT_FILES ? RECORDED_BASELINE_MS : Number.NaN));

describe.skipIf(!process.env.KB_MEASURE)("KB_MEASURE: forced worker-mode reindex over the 1.1 corpus (S73/S74, R4)", () => {
  const root = mkdtempSync(join(tmpdir(), "kb-measure-worker-"));
  let measured: { maxDelayMs: number; elapsedMs: number; files: number; chunks: number; spawned: boolean };
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    buildReindexCorpus(join(root, "docs"), { files });
    mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
    writeFileSync(join(root, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }] }));
    let sawWorker = false;
    const log = { info: (m: string) => (sawWorker ||= m.includes("reindex worker started")), warn: () => {} };
    const { result, maxDelayMs, elapsedMs } = await withEventLoopLag(() => reindexAll(root, log, { runner: createReindexRunner({ useWorker: () => true }) }));
    measured = { maxDelayMs, elapsedMs, files: result.changed, chunks: result.chunks, spawned: sawWorker };
    const line = `KB_MEASURE worker ${JSON.stringify({ ...measured, spawned: undefined })}`;
    console.log(line);
    if (process.env.KB_MEASURE_OUT) appendFileSync(process.env.KB_MEASURE_OUT, `${line}\n`);
  }, 900_000);

  it("S73: ran on a real worker and the main-thread max event-loop delay stays under 200 ms", () => {
    expect(measured.spawned).toBe(true);
    expect(measured.chunks).toBeGreaterThan(0);
    expect(measured.maxDelayMs).toBeLessThan(LAG_TARGET_MS);
  });

  it.skipIf(Number.isNaN(baselineMs))("S74: wall time ≤ 115 % of the recorded in-process baseline", () => {
    expect(measured.elapsedMs).toBeLessThanOrEqual(baselineMs * 1.15);
  });
});
