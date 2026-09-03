#!/usr/bin/env tsx
// Search-latency measurement over the bundled fixture index (a real index of
// this repo — same cache `run-fixtures.ts` uses).
//
//   NODE_OPTIONS=--experimental-sqlite tsx packages/kb/eval/measure-search-latency.ts [--fresh] [--enrich] [--json]
//
// Tasks:
//   1.1 — pre-change search median/p95 (the shipped 50 ms median budget gates).
//   3.5/P1 — with `--enrich`, the ADDITIVE verdict-enrichment median (advisory
//     15 ms target — RECORDED, deliberately no CI assertion).
//
// `--fresh` forces an index rebuild (minutes); default reuses the cached index.
// See change: add-kb-trust-verdicts-and-search-guard.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../src/config.js";
import { indexSource } from "../src/indexer.js";
import { SqliteFtsStore } from "../src/sqlite-store.js";
import type { SearchOpts } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

const fresh = process.argv.includes("--fresh");
const wantEnrich = process.argv.includes("--enrich");
const wantJson = process.argv.includes("--json");

const cacheDir = join(tmpdir(), "kb-eval-fixture-index");
if (fresh) rmSync(cacheDir, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });
const dbPath = join(cacheDir, "index.db");
const reused = !fresh && existsSync(dbPath);

const store = new SqliteFtsStore(dbPath);
store.init();
// Index options mirror run-fixtures.ts: config defaults + the worktree/dist
// guards, so the fixture corpus matches what the shipped config indexes.
const indexOpts = { indexAgentsFiles: true, includeSourceMarkdown: true, include: DEFAULTS.include, exclude: [...DEFAULTS.exclude, "**/.worktrees/**", "**/dist/**"], extensions: DEFAULTS.extensions };
const t0 = performance.now();
const stats = reused
  ? { scanned: store.counts().files, chunks: store.counts().chunks }
  : await (async () => {
      let changed = 0, chunks = 0;
      for (const s of [
        { root: "docs", dir: join(REPO, "docs") },
        { root: "openspec", dir: join(REPO, "openspec") },
        { root: "packages", dir: join(REPO, "packages") },
        { root: ".pi", dir: join(REPO, ".pi") },
      ]) {
        const st = await indexSource(store, s, indexOpts);
        changed += st.changed; chunks += st.chunks;
      }
      return { scanned: changed, chunks };
    })();
const indexedNote = reused
  ? `reused cached fixture index (${stats.chunks} chunks)`
  : `built fixture index (${stats.chunks} chunks) in ${((performance.now() - t0) / 1000).toFixed(1)}s`;

// Shipped-default search options, mirroring the kb-extension kb_search tool.
const opts: SearchOpts = {
  limit: 10,
  fieldWeights: DEFAULTS.ranking.fieldWeights,
  proximityBoost: DEFAULTS.ranking.proximityBoost,
  diversity: DEFAULTS.ranking.diversity,
  sourceDedup: DEFAULTS.ranking.sourceDedup,
  laneQuota: DEFAULTS.ranking.laneQuota,
  coverageRerank: DEFAULTS.ranking.coverageRerank,
  queryExpansion: DEFAULTS.queryExpansion.mode,
  prf: DEFAULTS.queryExpansion.prf,
  expandParent: DEFAULTS.expand.parent,
};

function queries(): string[] {
  const out: string[] = [];
  for (const f of ["golden.markdown-intent.json", "golden.source-intent.json"]) {
    const p = join(HERE, f);
    if (!existsSync(p)) continue;
    const raw = JSON.parse(readFileSync(p, "utf8"));
    for (const it of Array.isArray(raw) ? raw : raw.items) if (it.q) out.push(it.q);
  }
  return out;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

const qs = queries();
// Warmup: first FTS/vocab touch must not skew the distribution.
store.search(qs[0] ?? "kb", opts);

const searchMs: number[] = [];
const enrichMs: number[] = [];
let enrichedHits = 0;

for (const q of qs) {
  const a = performance.now();
  const hits = store.search(q, opts);
  searchMs.push(performance.now() - a);
  if (wantEnrich) {
    const { enrichHits: enrich } = await import("../src/verdict.js");
    const b = performance.now();
    await enrich(hits, { cwd: REPO });
    enrichMs.push(performance.now() - b);
    enrichedHits += hits.length;
  }
}

const sortedSearch = [...searchMs].sort((a, b) => a - b);
const result: Record<string, unknown> = {
  index: dbPath,
  indexState: indexedNote,
  queries: qs.length,
  searchMedianMs: +pct(sortedSearch, 50).toFixed(2),
  searchP95Ms: +pct(sortedSearch, 95).toFixed(2),
};
if (wantEnrich) {
  const sortedEnrich = [...enrichMs].sort((a, b) => a - b);
  result.enrichmentMedianMs = +pct(sortedEnrich, 50).toFixed(2);
  result.enrichmentP95Ms = +pct(sortedEnrich, 95).toFixed(2);
  result.enrichedHits = enrichedHits;
  result.advisoryTargetMs = 15;
}

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`# ${indexedNote}`);
  console.log(`queries:        ${qs.length}`);
  console.log(`search median:  ${result.searchMedianMs} ms   p95: ${result.searchP95Ms} ms   (shipped budget: 50 ms median)`);
  if (wantEnrich) {
    console.log(`enrich median:  ${result.enrichmentMedianMs} ms   p95: ${result.enrichmentP95Ms} ms   (ADVISORY target: 15 ms, no CI gate)`);
    console.log(`enriched hits:  ${enrichedHits}`);
  }
}
store.close();
