#!/usr/bin/env tsx
// Gate the retrieval change on the bundled golden sets: index THIS repo once,
// then score every configuration variant over both fixtures.
// See change: fix-kb-search-retrieval-quality.
//
//   tsx packages/kb/eval/run-fixtures.ts [--sweep] [--json]
//
// `--sweep` additionally walks the lane-quota share so the default is a measured
// choice rather than a guess (task 4.5).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../src/config.js";
import { evaluate, type GoldenItem } from "../src/eval.js";
import { indexSource } from "../src/indexer.js";
import { SqliteFtsStore } from "../src/sqlite-store.js";
import type { SearchOpts } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const K = 10;

function golden(name: string): GoldenItem[] {
  const raw = JSON.parse(readFileSync(join(HERE, name), "utf8"));
  return (Array.isArray(raw) ? raw : raw.items) as GoldenItem[];
}

const base: SearchOpts = {
  fieldWeights: DEFAULTS.ranking.fieldWeights,
  proximityBoost: DEFAULTS.ranking.proximityBoost,
  diversity: DEFAULTS.ranking.diversity,
  expandParent: false,
};

// PRE-CHANGE behaviour, reconstructed from the pre-change defaults: body-hash
// dedup only, no source dedup, no lane quota, no coverage rerank, no expansion.
const BASELINE: SearchOpts = { ...base, sourceDedup: false, laneQuota: 0, coverageRerank: false, queryExpansion: "off" };

const VARIANTS: Array<[string, SearchOpts]> = [
  ["baseline (pre-change)", BASELINE],
  ["+ source dedup (D1/D2)", { ...BASELINE, sourceDedup: true }],
  ["+ lane quota (D3)", { ...BASELINE, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota }],
  ["+ coverage rerank (D4a)", { ...BASELINE, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: true }],
  ["+ PRF (D4b) = shipped default", { ...base, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: true, queryExpansion: "prf", prf: DEFAULTS.queryExpansion.prf }],
  ["PRF WITHOUT coverage rerank (must be worse)", { ...BASELINE, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, queryExpansion: "prf", prf: DEFAULTS.queryExpansion.prf }],
];

// Reusable index: a full repo index is minutes of wall time, and every variant
// must be scored against the SAME corpus anyway. `--fresh` forces a rebuild.
const cacheDir = join(tmpdir(), "kb-eval-fixture-index");
const fresh = process.argv.includes("--fresh");
if (fresh) rmSync(cacheDir, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });
const dbPath = join(cacheDir, "index.db");
const reused = !fresh && existsSync(dbPath);
const store = new SqliteFtsStore(dbPath);
store.init();
const t0 = performance.now();
const stats = reused
  ? { scanned: store.counts().files, chunks: store.counts().chunks }
  : await indexSource(store, { root: "repo", dir: REPO }, { indexAgentsFiles: true, includeSourceMarkdown: true, exclude: [...DEFAULTS.exclude, "**/.worktrees/**", "**/dist/**"] });
const indexMs = performance.now() - t0;

const sets: Array<[string, GoldenItem[]]> = [
  ["markdown-intent", golden("golden.markdown-intent.json")],
  ["source-intent", golden("golden.source-intent.json")],
];

const rows: Record<string, unknown>[] = [];
for (const [setName, items] of sets) {
  for (const [label, opts] of VARIANTS) {
    const m = evaluate(store, items, { ...opts, k: K });
    rows.push({ set: setName, variant: label, n: m.n, "R@10": m["Recall@K"], "P@1": m["P@1"], "P@5": m["P@5"], MRR: m.MRR, "nDCG@10": m["nDCG@K"], distinctSrc: m.distinctSourcesAtK, dupShare: m.duplicateSlotShare, singleSrcPage: m.singleSourcePageRate, ms: m.avgLatencyMs });
  }
}

if (process.argv.includes("--sweep")) {
  // Sweep the lane share on the DEDUP-ONLY base. Sweeping on top of coverage
  // rerank + PRF would tune one knob inside a stack the fixtures say is a net
  // regression, and the share would be fitted to that regression.
  const shipped: SearchOpts = process.argv.includes("--sweep-with-d4")
    ? { ...base, sourceDedup: true, coverageRerank: true, queryExpansion: "prf", prf: DEFAULTS.queryExpansion.prf }
    : { ...BASELINE, sourceDedup: true };
  for (const share of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8]) {
    for (const [setName, items] of sets) {
      const m = evaluate(store, items, { ...shipped, laneQuota: share, k: K });
      rows.push({ set: `SWEEP ${setName}`, variant: `laneQuota=${share}`, n: m.n, "R@10": m["Recall@K"], "P@1": m["P@1"], "P@5": m["P@5"], MRR: m.MRR, "nDCG@10": m["nDCG@K"], distinctSrc: m.distinctSourcesAtK, dupShare: m.duplicateSlotShare, singleSrcPage: m.singleSourcePageRate, ms: m.avgLatencyMs });
    }
  }
}

store.close();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ index: { files: stats.scanned, chunks: stats.chunks, indexMs: Math.round(indexMs) }, k: K, rows }, null, 2));
} else {
  console.log(`${reused ? "reused" : "indexed"} ${stats.scanned} files / ${stats.chunks} chunks in ${Math.round(indexMs)}ms — K=${K}\n`);
  console.table(rows);
}
