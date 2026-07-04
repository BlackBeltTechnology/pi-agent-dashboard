// Phase-1 verification: index doc-example/ with the real package and check
// indexing perf, incremental no-op, search precision (golden set), dedup, graph.
// Run: NODE_OPTIONS=--experimental-sqlite tsx packages/kb/verify.ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteFtsStore } from "./src/sqlite-store.js";
import { indexSource } from "./src/indexer.js";

const ROOT = new URL("../../doc-example", import.meta.url).pathname;
const DB = join(tmpdir(), `kb-verify-${Date.now()}.db`);
const store = new SqliteFtsStore(DB);
store.init();

const t0 = performance.now();
const stats = await indexSource(store, { root: "doc-example", dir: ROOT });
const idxMs = performance.now() - t0;
const counts = store.counts();
console.log(`# index: ${stats.scanned} files, ${stats.changed} changed, ${stats.chunks} chunks in ${idxMs.toFixed(0)}ms`);
console.log(`# store: ${JSON.stringify(counts)}`);

// incremental no-op
const t1 = performance.now();
const again = await indexSource(store, { root: "doc-example", dir: ROOT });
console.log(`# reindex (no changes): ${again.changed} changed, ${again.deleted} deleted in ${(performance.now() - t1).toFixed(0)}ms (expect 0/0)`);

// golden set (subset of research §2.5)
const GOLD: { q: string; expect: string }[] = [
  { q: "automatically provision a user on first login", expect: "backend/authentication-guide.md" },
  { q: "validate a date or datetime field on a form", expect: "frontend/hooks/validation-hooks.md" },
  { q: "change the dark mode color palette", expect: "frontend/theming.md" },
  { q: "convert between entity layer and service layer types", expect: "integration-testing/type-safety.md" },
  { q: "data grid test is failing intermittently", expect: "e2e-testing/troubleshooting.md" },
  { q: "backend computed transient attribute JQL escape hatch", expect: "backend/interceptors.md" },
  { q: "decoupled service creation CQRS pattern with interceptor", expect: "backend/interceptors.md" },
  { q: "format of the data-testid for UI elements", expect: "frontend/model-screen-layout.md" },
];
let p1 = 0, mrr = 0, recall = 0, lat = 0;
for (const g of GOLD) {
  const s = performance.now();
  const res = store.search(g.q, { limit: 10 });
  lat += performance.now() - s;
  let first = 0;
  res.forEach((r, i) => { if (!first && r.path.includes(g.expect)) first = i + 1; });
  if (first === 1) p1++;
  if (first) { mrr += 1 / first; recall++; }
}
const n = GOLD.length;
console.log(`# search golden: P@1=${(p1 / n).toFixed(2)} Recall@10=${(recall / n).toFixed(2)} MRR=${(mrr / n).toFixed(2)} avgLatency=${(lat / n).toFixed(2)}ms`);

// dedup: cross-tree duplicate should collapse with aka_paths
const dupHit = store.search("decoupled service creation CQRS pattern", { limit: 5 }).find((h) => h.akaPaths?.length);
console.log(`# dedup: ${dupHit ? `collapsed, aka=${JSON.stringify(dupHit.akaPaths)}` : "no duplicate collapse observed"}`);

// doc_type filter (agents files in the corpus, if any)
const agentsHits = store.search("guide", { limit: 50 }).length;
console.log(`# doc_type filter sanity: 'guide' returns ${agentsHits} hits`);

// graph: neighbors of an interceptor section reach the parent guide
const sample = store.search("decoupled service creation CQRS", { limit: 1 })[0];
if (sample) {
  const nbrs = store.neighbors(sample.headingPath, 2);
  console.log(`# graph neighbors of "${sample.headingPath}": ${nbrs.length} nodes (depth 2)`);
  const bl = store.backlinks(sample.path);
  console.log(`# graph backlinks to ${sample.path}: ${bl.length}`);
}

store.close();
rmSync(DB, { force: true });
rmSync(DB + "-wal", { force: true });
rmSync(DB + "-shm", { force: true });
console.log("# done");
