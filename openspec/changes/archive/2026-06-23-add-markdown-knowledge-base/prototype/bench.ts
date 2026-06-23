/**
 * Throwaway prototype to validate the KB design against doc-example/.
 * Mirrors design §3 (structural heading chunking, fence-safe, breadcrumb)
 * and §6c (BM25F field weighting). Measures indexing perf + retrieval
 * precision/reliability with a grounded golden set. bun:sqlite (FTS5).
 */
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "/Users/robson/Project/pi-agent-dashboard/doc-example";

// ---------- walk ----------
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

// ---------- structural heading chunker (fence-safe) ----------
type Chunk = { path: string; headingPath: string; heading: string; level: number; body: string };
const MIN_CHUNK = 100;

function chunkFile(abs: string, rel: string): Chunk[] {
  let text = readFileSync(abs, "utf8");
  // strip YAML frontmatter
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) text = text.slice(end + 4);
  }
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  const stack: { level: number; title: string }[] = [];
  let cur: Chunk | null = null;
  let inFence = false;
  let fence = "";
  const fileTitle = rel.split("/").pop()!.replace(/\.md$/, "");

  const pushCur = () => { if (cur && cur.body.trim()) chunks.push(cur); };

  for (const line of lines) {
    const t = line.trimStart();
    // fence toggle
    const fm = t.match(/^(```+|~~~+)/);
    if (fm) {
      if (!inFence) { inFence = true; fence = fm[1][0]; }
      else if (t.startsWith(fence)) { inFence = false; }
      if (cur) cur.body += line + "\n";
      continue;
    }
    const hm = !inFence && line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      pushCur();
      const level = hm[1].length;
      const title = hm[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      const headingPath = stack.map((s) => s.title).join(" > ");
      cur = { path: rel, headingPath, heading: title, level, body: "" };
    } else {
      if (!cur) cur = { path: rel, headingPath: fileTitle, heading: fileTitle, level: 0, body: "" };
      cur.body += line + "\n";
    }
  }
  pushCur();
  // merge tiny chunks up into previous
  const merged: Chunk[] = [];
  for (const c of chunks) {
    if (c.body.length < MIN_CHUNK && merged.length) {
      merged[merged.length - 1].body += "\n" + c.headingPath + "\n" + c.body;
    } else merged.push(c);
  }
  return merged;
}

// ---------- build two index variants ----------
function buildDb(variant: "baseline" | "bm25f", chunks: Chunk[]) {
  const db = new Database(":memory:");
  db.run("PRAGMA journal_mode=WAL");
  if (variant === "baseline") {
    db.run(`CREATE VIRTUAL TABLE c USING fts5(path UNINDEXED, heading_path UNINDEXED, body, tokenize='porter unicode61')`);
    const ins = db.prepare("INSERT INTO c(path,heading_path,body) VALUES (?,?,?)");
    const tx = db.transaction((cs: Chunk[]) => { for (const c of cs) ins.run(c.path, c.headingPath, c.headingPath + "\n" + c.body); });
    tx(chunks);
  } else {
    db.run(`CREATE VIRTUAL TABLE c USING fts5(path UNINDEXED, heading_path, heading, body, tokenize='porter unicode61')`);
    const ins = db.prepare("INSERT INTO c(path,heading_path,heading,body) VALUES (?,?,?,?)");
    const tx = db.transaction((cs: Chunk[]) => { for (const c of cs) ins.run(c.path, c.headingPath, c.heading, c.body); });
    tx(chunks);
  }
  return db;
}

function ftsQuery(q: string): string {
  const terms = q.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const stop = new Set(["the","for","and","how","what","with","you","your","does","can","from","that","this","are","into","use","using","get","set","all"]);
  const kept = terms.filter((t) => !stop.has(t));
  return (kept.length ? kept : terms).map((t) => `"${t}"`).join(" OR ");
}

function search(db: Database, variant: string, q: string, k = 10) {
  const m = ftsQuery(q);
  if (!m) return [] as any[];
  const weights = variant === "bm25f" ? ", 8.0, 4.0, 1.0" : "";
  // bm25 args: per indexed column. baseline has 1 indexed col (body) -> no weights.
  const sql = variant === "bm25f"
    ? `SELECT path, heading_path, bm25(c, 0.0, 8.0, 4.0, 1.0) s FROM c WHERE c MATCH ? ORDER BY s LIMIT ${k}`
    : `SELECT path, heading_path, bm25(c) s FROM c WHERE c MATCH ? ORDER BY s LIMIT ${k}`;
  try { return db.query(sql).all(m) as any[]; } catch { return []; }
}

// ---------- golden set: paraphrased query -> expected file subpath ----------
const GOLD: { q: string; expect: string }[] = [
  { q: "automatically provision a user on first login", expect: "backend/authentication-guide.md" },
  { q: "extract claims and attributes from the auth token", expect: "backend/authentication-guide.md" },
  { q: "define a modeled business error and throw it", expect: "backend/error-handling-guide.md" },
  { q: "reference of API error codes and response structure", expect: "backend/error-handling-guide.md" },
  { q: "validate a date or datetime field on a form", expect: "frontend/hooks/validation-hooks.md" },
  { q: "run asynchronous validation against the backend", expect: "frontend/hooks/validation-hooks.md" },
  { q: "change the dark mode color palette", expect: "frontend/theming.md" },
  { q: "override a component style in the theme", expect: "frontend/theming.md" },
  { q: "convert between entity layer and service layer types", expect: "integration-testing/type-safety.md" },
  { q: "the adaptTo pattern for type mismatches", expect: "integration-testing/type-safety.md" },
  { q: "data grid test is failing intermittently", expect: "e2e-testing/troubleshooting.md" },
  { q: "capture screenshots and video when a test fails", expect: "e2e-testing/troubleshooting.md" },
  { q: "format of the data-testid for UI elements", expect: "frontend/model-screen-layout.md" },
  { q: "page container types in the UI model json", expect: "frontend/model-screen-layout.md" },
  { q: "backend computed transient attribute JQL escape hatch", expect: "backend/interceptors.md" },
  { q: "decoupled service creation CQRS pattern with interceptor", expect: "backend/interceptors.md" },
  { q: "intercept update and batch process related entities", expect: "backend/interceptors.md" },
  { q: "register an operation call interceptor component", expect: "backend/interceptors.md" },
  { q: "how to do data denormalization in an interceptor", expect: "backend/interceptors.md" },
  { q: "best practices for testing authentication interceptors", expect: "backend/authentication-guide.md" },
];

// collapse results whose body-hash repeats (exact-content dedup, design §6)
function dedupResults(db: Database, rows: any[]): any[] {
  const out: any[] = []; const seen = new Set<string>();
  for (const r of rows) {
    const body = db.query("SELECT body FROM c WHERE path=? AND heading_path=? LIMIT 1").get(r.path, r.heading_path) as any;
    const h = body ? Bun.hash((body.body as string).trim()).toString() : Math.random().toString();
    if (seen.has(h)) continue; seen.add(h); out.push(r);
  }
  return out;
}

function metrics(db: Database, variant: string, dedup = false) {
  let p1 = 0, p5 = 0, mrr = 0, ndcg = 0, recall = 0, dupNoise = 0;
  let lat = 0;
  for (const g of GOLD) {
    const t0 = performance.now();
    let res = search(db, variant === "bm25f+dedup" ? "bm25f" : variant, g.q, 20);
    if (dedup) res = dedupResults(db, res);
    res = res.slice(0, 10);
    lat += performance.now() - t0;
    const ranks: number[] = [];
    res.forEach((r, i) => { if (r.path.includes(g.expect)) ranks.push(i + 1); });
    const first = ranks.length ? ranks[0] : 0;
    if (first === 1) p1++;
    if (first >= 1 && first <= 5) p5++;
    if (first >= 1) { mrr += 1 / first; recall++; ndcg += 1 / Math.log2(first + 1); }
    // duplicate noise: same expected file appearing >1 in top5 (dup trees)
    const top5dups = res.slice(0, 5).filter((r) => r.path.includes(g.expect)).length;
    if (top5dups > 1) dupNoise++;
  }
  const n = GOLD.length;
  return {
    variant,
    "P@1": (p1 / n).toFixed(3), "P@5": (p5 / n).toFixed(3),
    "Recall@10": (recall / n).toFixed(3), MRR: (mrr / n).toFixed(3),
    "nDCG@10": (ndcg / n).toFixed(3),
    "dupNoise@5": `${dupNoise}/${n}`,
    "avgLatencyMs": (lat / n).toFixed(2),
  };
}

// ---------- run ----------
console.log(`# KB prototype benchmark over ${ROOT}\n`);
const tWalk = performance.now();
const files = walk(ROOT);
console.log(`files: ${files.length}  walk: ${(performance.now() - tWalk).toFixed(0)}ms`);

const tChunk = performance.now();
let chunks: Chunk[] = [];
let bytes = 0;
for (const f of files) { bytes += statSync(f).size; chunks = chunks.concat(chunkFile(f, relative(ROOT, f))); }
console.log(`chunks: ${chunks.length}  (${(chunks.length / files.length).toFixed(1)}/file)  corpus: ${(bytes/1e6).toFixed(2)}MB  chunk+parse: ${(performance.now() - tChunk).toFixed(0)}ms`);

// dedup stat: identical body hashes
const seen = new Map<string, number>();
for (const c of chunks) { const h = Bun.hash(c.body.trim()).toString(); seen.set(h, (seen.get(h) ?? 0) + 1); }
const dupChunks = [...seen.values()].filter((v) => v > 1).reduce((a, v) => a + (v - 1), 0);
console.log(`exact-duplicate chunks (cross-tree): ${dupChunks} (${(100*dupChunks/chunks.length).toFixed(1)}% redundant)\n`);

const dbBase = buildDb("baseline", chunks);
console.log("## BASELINE"); console.log(JSON.stringify(metrics(dbBase, "baseline"), null, 0)); dbBase.close(); console.log();
const dbF = buildDb("bm25f", chunks);
console.log("## BM25F"); console.log(JSON.stringify(metrics(dbF, "bm25f"), null, 0)); console.log();
console.log("## BM25F + exact-content dedup"); console.log(JSON.stringify(metrics(dbF, "bm25f+dedup", true), null, 0)); dbF.close(); console.log();

// sample qualitative output
const db = buildDb("bm25f", chunks);
console.log("## sample top-3 (BM25F) for 3 queries");
for (const g of GOLD.slice(0, 3)) {
  console.log(`Q: ${g.q}  (expect ~${g.expect})`);
  for (const r of search(db, "bm25f", g.q, 3)) console.log(`   ${r.s.toFixed(2)}  ${r.path}  ::  ${r.heading_path}`);
}
db.close();
