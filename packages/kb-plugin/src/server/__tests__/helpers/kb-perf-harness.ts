/**
 * Shared reader/writer harness for the kb search perf files: `kb-search-perf.test.ts`
 * (blocking S61 functional assertions, KB_MEASURE S76) and `kb-search-perf.budget.test.ts`
 * (budget lane: P1 p95, S61 tail bound). Samples `/api/kb/search` + `/api/kb/stats` while a
 * worker-thread reindex writes, so every consumer measures the same loop.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { buildReindexCorpus } from "../../../../../kb/src/__tests__/helpers/reindex-corpus.js";
import { KbJobRegistry } from "../../job-registry.js";
import { mountKbRoutes } from "../../kb-routes.js";
import { createReindexRunner } from "../../reindex-runner.js";

export const p95Of = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
};

export interface ReaderSamples {
  calls: number;
  times: number[];
  searchTimes: number[];
  statsTimes: number[];
  errors: string[];
  files: number[];
  chunks: number[];
}

/** Hits `/search` + `/stats` in turn while `running()`; records latency, failures and the observed counts. */
export async function sampleReaders(app: FastifyInstance, cwd: string, running: () => boolean): Promise<ReaderSamples> {
  const q = encodeURIComponent(cwd);
  const out: ReaderSamples = { calls: 0, times: [], searchTimes: [], statsTimes: [], errors: [], files: [], chunks: [] };
  while (running()) {
    for (const url of [`/api/kb/search?cwd=${q}&q=${encodeURIComponent("bridge session")}`, `/api/kb/stats?cwd=${q}`]) {
      const isStats = url.includes("/stats");
      const t0 = performance.now();
      const res = await app.inject({ method: "GET", url });
      const ms = performance.now() - t0;
      out.calls++;
      out.times.push(ms);
      (isStats ? out.statsTimes : out.searchTimes).push(ms);
      if (res.statusCode !== 200) out.errors.push(`${url} → ${res.statusCode} ${res.body.slice(0, 200)}`);
      else if (isStats) {
        const b = res.json();
        out.files.push(b.files);
        out.chunks.push(b.chunks);
      }
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  return out;
}

export async function readWhileWorkerWrites(cwd: string, newFiles: number): Promise<ReaderSamples & { idleSearchTimes: number[]; spawnedWorker: boolean }> {
  const app = Fastify();
  const registry = new KbJobRegistry();
  const logs: string[] = [];
  // The host logger seam (the server runs Fastify with logger:false): record the job's lifecycle lines.
  const logger = { info: (m: string) => void logs.push(m), warn: (m: string) => void logs.push(m), error: (m: string) => void logs.push(m) };
  mountKbRoutes(app, { knownCwds: () => [cwd], registry, logger, reindexRunner: createReindexRunner({ useWorker: () => true }) });
  const q = encodeURIComponent(cwd);
  const get = (url: string) => app.inject({ method: "GET", url });
  try {
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${q}` }); // seed: first index of the small folder
    while (registry.isRunning(cwd)) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 2; i++) await get(`/api/kb/search?cwd=${q}&q=bridge`); // warm the main-thread read paths
    await get(`/api/kb/stats?cwd=${q}`);
    buildReindexCorpus(join(cwd, "docs", "more"), { files: newFiles }); // new work for an in-place pass
    logs.length = 0; // only the measured pass's lifecycle lines count below (not the seed pass's)
    await app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${q}` });
    const samples = await sampleReaders(app, cwd, () => registry.isRunning(cwd));
    // Control: the same search once the writer is gone, to separate index-size cost from writer contention.
    const idleSearchTimes: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await get(`/api/kb/search?cwd=${q}&q=${encodeURIComponent("bridge session")}`);
      idleSearchTimes.push(performance.now() - t0);
    }
    // the measured pass ended on the worker (a pre-`ready` failure logs "worker started" and then falls back in-process)
    const spawnedWorker = /reindex mode=worker .* outcome=ok /.test(logs.filter((l) => /\] reindex mode=/.test(l)).at(-1) ?? "");
    return { ...samples, idleSearchTimes, spawnedWorker };
  } finally {
    await app.close();
  }
}

export function seededFolder(): string {
  const cwd = mkdtempSync(join(tmpdir(), "kb-perf-iso-"));
  mkdirSync(join(cwd, "docs"), { recursive: true });
  mkdirSync(join(cwd, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }] }));
  for (let f = 0; f < 20; f++) writeFileSync(join(cwd, "docs", `seed${f}.md`), `# Seed ${f}\n\nbridge session handling ${"filler ".repeat(40)}\n`);
  return cwd;
}
