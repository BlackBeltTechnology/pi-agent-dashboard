#!/usr/bin/env tsx
// Render repricing: token/byte cost of a rendered result page, before vs after
// (source dedup + leaf heading + suppressed-section marker).
// See change: fix-kb-search-retrieval-quality (design D5).
//
//   tsx packages/kb/eval/measure-render.ts
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../src/config.js";
import { renderHits } from "../src/render.js";
import { searchOptsFromConfig } from "../src/search-opts.js";
import { SqliteFtsStore } from "../src/sqlite-store.js";
import type { KbHit, SearchOpts } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const dbPath = join(tmpdir(), "kb-eval-fixture-index", "index.db");
if (!existsSync(dbPath)) {
  console.error("no cached fixture index — run: tsx packages/kb/eval/run-fixtures.ts --fresh");
  process.exit(2);
}
const store = new SqliteFtsStore(dbPath);

const queries = [
  ...(JSON.parse(readFileSync(join(HERE, "golden.markdown-intent.json"), "utf8")).items as { q: string }[]),
  ...(JSON.parse(readFileSync(join(HERE, "golden.source-intent.json"), "utf8")).items as { q: string }[]),
].map((x) => x.q);

// Options derive from the ONE shared config→SearchOpts mapping (design D2,
// fix-kb-eval-measurement-integrity); BEFORE/AFTER differ by explicit overrides.
const variant = (ov: Parameters<typeof searchOptsFromConfig>[1]["overrides"]) =>
  searchOptsFromConfig(DEFAULTS, {
    sources: [{ id: "repo", dir: "/", priority: 0 }], // rootPriority is inert here (single root index)
    overrides: { expandParent: true, expandGraph: false, rerank: false, queryExpansion: "off", ...ov },
  });
const BEFORE: SearchOpts = variant({ sourceDedup: false, laneQuota: 0, coverageRerank: false });
const AFTER: SearchOpts = variant({ sourceDedup: true, laneQuota: DEFAULTS.ranking.laneQuota, coverageRerank: DEFAULTS.ranking.coverageRerank });

const TOOL = { leading: "rank", parentGlyph: "\u2937 ", multiline: true } as const;
// ~4 chars/token is the usual English-prose rule of thumb; used only to compare
// two renders of the SAME pages, so the constant cancels.
const tokens = (s: string) => Math.round(s.length / 4);

/** Legacy render: full breadcrumb, no suppressed-section marker. */
function legacyRender(hits: KbHit[]): string {
  return hits
    .map((h, i) => {
      const lines = [`${i + 1}  ${h.path}  ::  ${h.headingPath}`];
      if (h.akaPaths?.length) lines.push(`   (+${h.akaPaths.length} dup)`);
      if (h.parent) lines.push(`   \u2937 ${h.parent.headingPath}`);
      lines.push(`   ${h.snippet.replace(/\s+/g, " ").slice(0, 160)}`);
      return lines.join("\n");
    })
    .join("\n");
}

let beforeTok = 0;
let afterTok = 0;
let beforeSrc = 0;
let afterSrc = 0;
for (const q of queries) {
  const b = store.search(q, { ...BEFORE, limit: 10 });
  const a = store.search(q, { ...AFTER, limit: 10 });
  beforeTok += tokens(legacyRender(b));
  afterTok += tokens(renderHits(a, TOOL));
  beforeSrc += new Set(b.map((h) => `${h.root}\u001f${h.path}`)).size;
  afterSrc += new Set(a.map((h) => `${h.root}\u001f${h.path}`)).size;
}
store.close();

const n = queries.length;
const row = {
  queries: n,
  meanTokensBefore: +(beforeTok / n).toFixed(1),
  meanTokensAfter: +(afterTok / n).toFixed(1),
  deltaPct: `${(((afterTok - beforeTok) / beforeTok) * 100).toFixed(1)}%`,
  distinctSourcesBefore: +(beforeSrc / n).toFixed(2),
  distinctSourcesAfter: +(afterSrc / n).toFixed(2),
};
console.log(JSON.stringify(row, null, 2));
// Requirement: the rendered page must not cost MORE than before.
if (afterTok > beforeTok) {
  console.error("REGRESSION: rendered page grew");
  process.exitCode = 1;
}
