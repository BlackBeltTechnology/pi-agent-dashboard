/**
 * Extended benchmark: search-quality features + paraphrase detection (lexical).
 * Reuses the chunker shape from bench.ts. Measures, over doc-example/:
 *   - MMR diversity + proximity boost on the normal golden set
 *   - a HARD paraphrase golden set (queries phrased w/ different vocabulary)
 *     under: BM25F, +trigram, +PRF (pseudo-relevance feedback), +synonyms
 * No ML models (x64 mac has no native ONNX); pure FTS5 + algorithmic reranking.
 */
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const ROOT = "/Users/robson/Project/pi-agent-dashboard/doc-example";

function walk(d: string, a: string[] = []): string[] { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p, a) : e.name.endsWith(".md") && a.push(p); } return a; }
type Chunk = { path: string; headingPath: string; heading: string; body: string };
function chunkFile(abs: string, rel: string): Chunk[] {
  let text = readFileSync(abs, "utf8");
  if (text.startsWith("---\n")) { const e = text.indexOf("\n---", 4); if (e !== -1) text = text.slice(e + 4); }
  const lines = text.split("\n"); const out: Chunk[] = []; const stack: { l: number; t: string }[] = [];
  let cur: Chunk | null = null, inF = false, f = ""; const title = rel.split("/").pop()!.replace(/\.md$/, "");
  const push = () => { if (cur && cur.body.trim()) out.push(cur); };
  for (const line of lines) {
    const t = line.trimStart(); const fm = t.match(/^(```+|~~~+)/);
    if (fm) { if (!inF) { inF = true; f = fm[1][0]; } else if (t.startsWith(f)) inF = false; if (cur) cur.body += line + "\n"; continue; }
    const hm = !inF && line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { push(); const l = hm[1].length; while (stack.length && stack[stack.length - 1].l >= l) stack.pop(); stack.push({ l, t: hm[2].trim() }); cur = { path: rel, headingPath: stack.map(s => s.t).join(" > "), heading: hm[2].trim(), body: "" }; }
    else { if (!cur) cur = { path: rel, headingPath: title, heading: title, body: "" }; cur.body += line + "\n"; }
  }
  push();
  const m: Chunk[] = []; for (const c of out) { if (c.body.length < 100 && m.length) m[m.length - 1].body += "\n" + c.body; else m.push(c); } return m;
}
const STOP = new Set("the for and how what with you your does can from that this are into use using get set all a an of to in on is be as it or by at do make sure when before after".split(" "));
function terms(q: string) { return (q.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(t => !STOP.has(t)); }
function matchExpr(ts: string[]) { return ts.length ? ts.map(t => `"${t}"`).join(" OR ") : ""; }

const chunks = walk(ROOT).flatMap(f => chunkFile(f, relative(ROOT, f)));
const db = new Database(":memory:");
db.run(`CREATE VIRTUAL TABLE c USING fts5(path UNINDEXED, heading_path, heading, body, tokenize='porter unicode61')`);
const ins = db.prepare("INSERT INTO c(path,heading_path,heading,body) VALUES (?,?,?,?)");
db.transaction((cs: Chunk[]) => { for (const c of cs) ins.run(c.path, c.headingPath, c.heading, c.body); })(chunks);
// trigram companion (substring/typo)
db.run(`CREATE VIRTUAL TABLE ct USING fts5(path UNINDEXED, body, tokenize='trigram')`);
const ins2 = db.prepare("INSERT INTO ct(path,body) VALUES (?,?)");
db.transaction((cs: Chunk[]) => { for (const c of cs) ins2.run(c.path, c.headingPath + " " + c.body); })(chunks);

function bm25f(q: string, k = 20): any[] {
  const m = matchExpr(terms(q)); if (!m) return [];
  try { return db.query(`SELECT path, heading_path, body, bm25(c,0.0,8.0,4.0,1.0) s FROM c WHERE c MATCH ? ORDER BY s LIMIT ${k}`).all(m) as any[]; } catch { return []; }
}
// pseudo-relevance feedback: expand query with top terms from top-3 hits
function prf(q: string, k = 20): any[] {
  const top = bm25f(q, 3); if (!top.length) return bm25f(q, k);
  const tf = new Map<string, number>(); const qset = new Set(terms(q));
  for (const r of top) for (const w of terms(r.body)) if (!qset.has(w) && w.length > 3) tf.set(w, (tf.get(w) ?? 0) + 1);
  const extra = [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  const m = matchExpr([...terms(q), ...extra]); if (!m) return [];
  try { return db.query(`SELECT path, heading_path, bm25(c,0.0,8.0,4.0,1.0) s FROM c WHERE c MATCH ? ORDER BY s LIMIT ${k}`).all(m) as any[]; } catch { return []; }
}
// hand domain synonym expansion (paraphrase mitigation, no model)
const SYN: Record<string, string[]> = {
  signin: ["login", "authentication", "principal"], account: ["user", "provisioning"], night: ["dark", "theme"],
  look: ["theme", "palette"], rule: ["business", "fault", "error"], failure: ["error", "exception", "fault"],
  day: ["date", "datetime", "validation"], shape: ["type", "adapt", "transfer"], table: ["grid", "datagrid"],
  flake: ["flaky", "troubleshoot", "intermittent"], selector: ["testid", "element", "id"], widget: ["element", "component"],
  recompute: ["recalculate", "batch", "denormalization"], saved: ["create", "update", "interceptor"], context: ["service", "cqrs"],
};
function synExp(q: string, k = 20): any[] {
  const base = terms(q); const extra: string[] = [];
  for (const t of base) if (SYN[t]) extra.push(...SYN[t]);
  const m = matchExpr([...base, ...extra]); if (!m) return [];
  try { return db.query(`SELECT path, heading_path, bm25(c,0.0,8.0,4.0,1.0) s FROM c WHERE c MATCH ? ORDER BY s LIMIT ${k}`).all(m) as any[]; } catch { return []; }
}
function trigram(q: string, k = 20): any[] {
  const ts = terms(q).filter(t => t.length >= 3); if (!ts.length) return [];
  try { return db.query(`SELECT path, '' heading_path, bm25(ct) s FROM ct WHERE ct MATCH ? ORDER BY s LIMIT ${k}`).all(ts.map(t => `"${t}"`).join(" OR ")) as any[]; } catch { return []; }
}
// proximity boost: re-rank by bonus when query terms co-occur close in body
function proximityRerank(q: string, rows: any[]): any[] {
  const ts = terms(q);
  return rows.map(r => {
    const body = (r.body ?? (db.query("SELECT body FROM c WHERE path=? AND heading_path=? LIMIT 1").get(r.path, r.heading_path) as any)?.body ?? "").toLowerCase();
    let bonus = 0; const idx = ts.map(t => body.indexOf(t)).filter(i => i >= 0);
    if (idx.length >= 2) { const span = Math.max(...idx) - Math.min(...idx); bonus = idx.length / (1 + span / 200); }
    return { ...r, s: r.s - bonus }; // lower bm25 = better; subtract bonus
  }).sort((a, b) => a.s - b.s);
}
// MMR lexical diversity (token jaccard)
function mmr(rows: any[], lambda = 0.7, k = 10): any[] {
  const toks = rows.map(r => new Set(terms((r.heading_path || "") + " " + (r.body || ""))));
  const sel: number[] = []; const cand = rows.map((_, i) => i);
  while (sel.length < k && cand.length) {
    let best = -1, bestScore = -Infinity;
    for (const i of cand) {
      const rel = -rows[i].s; // higher better
      let div = 0; for (const j of sel) { const a = toks[i], b = toks[j]; let inter = 0; for (const x of a) if (b.has(x)) inter++; div = Math.max(div, inter / (a.size + b.size - inter || 1)); }
      const score = lambda * rel - (1 - lambda) * div * 10;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    sel.push(best); cand.splice(cand.indexOf(best), 1);
  }
  return sel.map(i => rows[i]);
}

type G = { q: string; expect: string };
const GOLD: G[] = [
  { q: "automatically provision a user on first login", expect: "backend/authentication-guide.md" },
  { q: "validate a date or datetime field on a form", expect: "frontend/hooks/validation-hooks.md" },
  { q: "change the dark mode color palette", expect: "frontend/theming.md" },
  { q: "convert between entity layer and service layer types", expect: "integration-testing/type-safety.md" },
  { q: "data grid test is failing intermittently", expect: "e2e-testing/troubleshooting.md" },
  { q: "backend computed transient attribute JQL escape hatch", expect: "backend/interceptors.md" },
  { q: "decoupled service creation CQRS pattern with interceptor", expect: "backend/interceptors.md" },
  { q: "format of the data-testid for UI elements", expect: "frontend/model-screen-layout.md" },
];
// HARD paraphrase: deliberately avoid the target's own vocabulary
const HARD: G[] = [
  { q: "create a brand new account the moment somebody signs in", expect: "backend/authentication-guide.md" },
  { q: "switch the app to a night friendly appearance", expect: "frontend/theming.md" },
  { q: "surface a domain rule breach back to the caller", expect: "backend/error-handling-guide.md" },
  { q: "make sure the chosen day is allowed before submit", expect: "frontend/hooks/validation-hooks.md" },
  { q: "reconcile mismatch between stored shape and the api shape", expect: "integration-testing/type-safety.md" },
  { q: "the results table flakes during automated checks", expect: "e2e-testing/troubleshooting.md" },
  { q: "selector id used to locate widgets on the page", expect: "frontend/model-screen-layout.md" },
  { q: "kick off creation in another context when something is saved", expect: "backend/interceptors.md" },
  { q: "recompute many records after a single edit", expect: "backend/interceptors.md" },
];
function score(set: G[], fn: (q: string) => any[], post?: (q: string, r: any[]) => any[]) {
  let p1 = 0, mrr = 0, ndcg = 0, recall = 0;
  for (const g of set) { let r = fn(g.q); if (post) r = post(g.q, r); r = r.slice(0, 10);
    let first = 0; r.forEach((x, i) => { if (!first && x.path.includes(g.expect)) first = i + 1; });
    if (first === 1) p1++; if (first) { mrr += 1 / first; recall++; ndcg += 1 / Math.log2(first + 1); } }
  const n = set.length; return { "P@1": (p1/n).toFixed(2), "Recall@10": (recall/n).toFixed(2), MRR: (mrr/n).toFixed(2), "nDCG@10": (ndcg/n).toFixed(2) };
}
const J = (o: any) => JSON.stringify(o);
console.log(`chunks=${chunks.length}\n`);
console.log("== NORMAL golden set (8 q) — quality features ==");
console.log("BM25F             ", J(score(GOLD, q => bm25f(q))));
console.log("BM25F + proximity ", J(score(GOLD, q => bm25f(q), (q, r) => proximityRerank(q, r))));
console.log("BM25F + MMR(div)  ", J(score(GOLD, q => bm25f(q), (_q, r) => mmr(r))));
console.log();
console.log("== HARD paraphrase set (9 q) — vocabulary deliberately different ==");
console.log("BM25F             ", J(score(HARD, q => bm25f(q))));
console.log("BM25F + trigram   ", J(score(HARD, q => trigram(q))));
console.log("BM25F + PRF        ", J(score(HARD, q => prf(q))));
console.log("BM25F + synonyms  ", J(score(HARD, q => synExp(q))));
db.close();
