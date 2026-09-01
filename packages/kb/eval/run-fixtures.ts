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
import { evaluate, type GoldenItem, type RootRef } from "../src/eval.js";
import { indexSource } from "../src/indexer.js";
import { searchOptsFromConfig, type SearchOptsOverrides } from "../src/search-opts.js";
import { SqliteFtsStore } from "../src/sqlite-store.js";
import { buildPairedRow } from "./sweep-rows.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const K = 10;

function golden(name: string): GoldenItem[] {
  const raw = JSON.parse(readFileSync(join(HERE, name), "utf8"));
  return (Array.isArray(raw) ? raw : raw.items) as GoldenItem[];
}

// All variants are `overrides` over the ONE shared config→SearchOpts mapping
// (design D2, fix-kb-eval-measurement-integrity) instead of hand-built literals.
const REPO_SRC = [{ id: "repo", dir: REPO, priority: 0 }];
// `evaluate` builds its reachability sets from `roots` (design D4,
// fix-kb-eval-measurement-integrity). Omitting them is NOT a neutral default:
// both `firstSegs` and `topSegs` come out empty, so EVERY expect containing a
// separator is ruled unreachable and silently dropped — measured 104/104
// source-intent and 96/108 markdown-intent items scored as n=0/n=12. The repo
// root has an empty relPrefix (root === cwd), so it qualifies items through
// rule (b): the top-level entries of `dir`.
const REPO_ROOTS: RootRef[] = [{ id: "repo", relPrefix: "", dir: REPO }];
/** A variant = shared base + explicit overrides. CLI-only knobs (expandGraph,
 *  rerank) and expansion stay pinned to the pre-change shape. */
const variant = (ov: SearchOptsOverrides) =>
  searchOptsFromConfig(DEFAULTS, {
    sources: REPO_SRC,
    overrides: {
      expandParent: false,
      expandGraph: false,
      rerank: false,
      queryExpansion: "off",
      sourceDedup: false,
      laneQuota: 0,
      coverageRerank: false,
      ...ov,
    },
  });

// PRE-CHANGE behaviour, reconstructed from the pre-change defaults: body-hash
// dedup only, no source dedup, no lane quota, no coverage rerank, no expansion.
const BASELINE = variant({});

const VARIANTS: Array<[string, SearchOpts]> = [
  ["baseline (pre-change)", BASELINE],
  ["+ source dedup (D1/D2)", variant({ sourceDedup: true })],
  ["+ lane quota (D3)", variant({ sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota })],
  ["+ coverage rerank (D4a)", variant({ sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: true })],
  [
    "+ PRF (D4b) = shipped default",
    variant({ expandParent: DEFAULTS.expand.parent, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: true, queryExpansion: "prf" }),
  ],
  [
    "PRF WITHOUT coverage rerank (must be worse)",
    variant({ sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, queryExpansion: "prf" }),
  ],
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

/** A fixture that scores zero items is a harness failure, not a result: every
 *  metric reads 0 and looks like a catastrophic regression. Fail loudly. */
function assertScored(setName: string, label: string, m: { n: number; unreachable: number }): void {
  if (m.n === 0) throw new Error(`[kb eval] ${setName} / ${label}: 0 of ${m.unreachable} golden items reachable — harness misconfiguration, not a measurement`);
}

const rows: Record<string, unknown>[] = [];
for (const [setName, items] of sets) {
  for (const [label, opts] of VARIANTS) {
    const m = evaluate(store, items, { ...opts, k: K, roots: REPO_ROOTS });
    assertScored(setName, label, m);
    rows.push({ set: setName, variant: label, n: m.n, "R@10": m["Recall@K"], "P@1": m["P@1"], "P@5": m["P@5"], MRR: m.MRR, "nDCG@10": m["nDCG@K"], distinctSrc: m.distinctSourcesAtK, dupShare: m.duplicateSlotShare, singleSrcPage: m.singleSourcePageRate, ms: m.avgLatencyMs });
  }
}

if (process.argv.includes("--sweep")) {
  // Sweep the lane share on the DEDUP-ONLY base. Sweeping on top of coverage
  // rerank + PRF would tune one knob inside a stack the fixtures say is a net
  // regression, and the share would be fitted to that regression.
  const shipped: SearchOpts = process.argv.includes("--sweep-with-d4")
    ? variant({ expandParent: DEFAULTS.expand.parent, sourceDedup: true, coverageRerank: true, queryExpansion: "prf" })
    : variant({ sourceDedup: true });
  for (const share of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8]) {
    for (const [setName, items] of sets) {
      const m = evaluate(store, items, { ...shipped, laneQuota: share, k: K, roots: REPO_ROOTS });
      assertScored(setName, `laneQuota=${share}`, m);
      rows.push({ set: `SWEEP ${setName}`, variant: `laneQuota=${share}`, n: m.n, "R@10": m["Recall@K"], "P@1": m["P@1"], "P@5": m["P@5"], MRR: m.MRR, "nDCG@10": m["nDCG@K"], distinctSrc: m.distinctSourcesAtK, dupShare: m.duplicateSlotShare, singleSrcPage: m.singleSourcePageRate, ms: m.avgLatencyMs });
    }
  }
}

// --- lane-lead margin axis (change fix-kb-search-lane-composition, design D6).
// Reported as PAIRED rows: both fixtures side by side on one line, because a
// gain in one lane next to an unreported regression in the other is not
// evidence. `buildPairedRow` refuses to build a half-reported row.
const marginRows: Record<string, unknown>[] = [];
if (process.argv.includes("--sweep")) {
  // Base = what the extension actually passes (shipped config, via the shared
  // helper), so the swept knob is measured inside the deployed stack.
  const shipped = variant({ expandParent: DEFAULTS.expand.parent, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota });
  // D2's unchecked interaction: `coverageRerank` re-sorts a lane, so the
  // re-sorted head differs from the raw best the lead rule compares. One
  // spot-check row, not full coverage.
  const covPrf = variant({ expandParent: DEFAULTS.expand.parent, sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: true, queryExpansion: "prf" });
  const axis: Array<[string, SearchOpts, number[]]> = [
    ["", shipped, [0, 0.1, 0.2, 0.3, 0.5]], // 1.0 excluded: degenerate always-fire endpoint (D2)
    [" +cov+prf", covPrf, [0, 0.2]],
  ];
  for (const [suffix, base, grid] of axis) {
    for (const margin of grid) {
      const bySet = new Map(sets.map(([setName, items]) => [setName, evaluate(store, items, { ...base, laneLeadMargin: margin, k: K, roots: REPO_ROOTS })]));
      marginRows.push(buildPairedRow(`laneLeadMargin=${margin}${suffix}`, bySet));
    }
  }
}

store.close();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ index: { files: stats.scanned, chunks: stats.chunks, indexMs: Math.round(indexMs) }, k: K, rows, marginRows }, null, 2));
} else {
  console.log(`${reused ? "reused" : "indexed"} ${stats.scanned} files / ${stats.chunks} chunks in ${Math.round(indexMs)}ms — K=${K}\n`);
  console.table(rows);
  if (marginRows.length) {
    console.log("\nlane-lead margin (paired fixtures, design D6):");
    console.table(marginRows);
  }
}
