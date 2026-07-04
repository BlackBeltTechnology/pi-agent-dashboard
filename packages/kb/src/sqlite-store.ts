// Default KbStore backend over node:sqlite (Node built-in; FTS5 verified).
// Zero runtime deps. Requires --experimental-sqlite on current Node.
// better-sqlite3 is a drop-in fallback behind the same KbStore interface.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Chunk, FileState, GraphEdge, GraphNode, KbHit, KbStore, SearchOpts } from "./types.js";

const DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
  root UNINDEXED, path UNINDEXED, chunk_id UNINDEXED, doc_type UNINDEXED,
  parent_chunk_id UNINDEXED, level UNINDEXED, body_hash UNINDEXED,
  heading_path, heading, body,
  tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS files (
  root TEXT, path TEXT, mtime_ms REAL, sha256 TEXT,
  PRIMARY KEY (root, path)
);
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY, type TEXT, name TEXT, path TEXT,
  UNIQUE(type, name)
);
CREATE TABLE IF NOT EXISTS edges (
  src INTEGER, dst INTEGER, rel TEXT, weight REAL DEFAULT 1,
  PRIMARY KEY (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
`;

// FTS5 query builder: OR the alphanumeric terms (recall + BM25 ranks).
function toMatch(q: string): string {
  const terms = tokenize(q);
  const kept = terms.length ? terms : (q.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
  return kept.map((t) => `"${t}"`).join(" OR ");
}

export class SqliteFtsStore implements KbStore {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    // Let a concurrent reader (e.g. `/stats` during a reindex) wait briefly for a
    // batch's write lock instead of failing with SQLITE_BUSY. See change:
    // fix-kb-index-feedback.
    this.db.exec("PRAGMA busy_timeout=5000");
  }
  init() {
    this.db.exec(DDL);
  }
  begin() {
    this.db.exec("BEGIN");
  }
  commit() {
    this.db.exec("COMMIT");
  }
  rollback() {
    try {
      this.db.exec("ROLLBACK");
    } catch {}
  }
  close() {
    this.db.close();
  }

  getFileState(root: string, path: string): FileState | null {
    const r = this.db.prepare("SELECT mtime_ms, sha256 FROM files WHERE root=? AND path=?").get(root, path) as any;
    return r ? { mtimeMs: r.mtime_ms, sha256: r.sha256 } : null;
  }
  setFileState(root: string, path: string, s: FileState) {
    this.db.prepare("INSERT INTO files(root,path,mtime_ms,sha256) VALUES(?,?,?,?) ON CONFLICT(root,path) DO UPDATE SET mtime_ms=excluded.mtime_ms, sha256=excluded.sha256").run(root, path, s.mtimeMs, s.sha256);
  }
  listPaths(root: string): string[] {
    return (this.db.prepare("SELECT path FROM files WHERE root=?").all(root) as any[]).map((r) => r.path);
  }
  deleteByPath(root: string, path: string) {
    this.db.prepare("DELETE FROM chunks WHERE root=? AND path=?").run(root, path);
    // outbound edges originate from this file's nodes; prune nodes owned by path then dangling edges
    const owned = this.db.prepare("SELECT id FROM nodes WHERE path=?").all(path) as any[];
    for (const n of owned) this.db.prepare("DELETE FROM edges WHERE src=? OR dst=?").run(n.id, n.id);
    this.db.prepare("DELETE FROM nodes WHERE path=?").run(path);
    this.db.prepare("DELETE FROM files WHERE root=? AND path=?").run(root, path);
  }

  insertChunk(c: Chunk) {
    this.db
      .prepare("INSERT INTO chunks(root,path,chunk_id,doc_type,parent_chunk_id,level,body_hash,heading_path,heading,body) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(c.root, c.path, c.chunkId, c.docType, c.parentChunkId, c.level, c.bodyHash, c.headingPath, c.heading, c.body);
  }
  addNode(n: GraphNode) {
    this.db.prepare("INSERT INTO nodes(type,name,path) VALUES(?,?,?) ON CONFLICT(type,name) DO UPDATE SET path=COALESCE(excluded.path, nodes.path)").run(n.type, n.name, n.path);
  }
  addEdge(e: GraphEdge) {
    const src = this.db.prepare("SELECT id FROM nodes WHERE name=? LIMIT 1").get(e.src) as any;
    const dst = this.db.prepare("SELECT id FROM nodes WHERE name=? LIMIT 1").get(e.dst) as any;
    if (!src || !dst) return;
    this.db.prepare("INSERT OR IGNORE INTO edges(src,dst,rel,weight) VALUES(?,?,?,?)").run(src.id, dst.id, e.rel, e.weight ?? 1);
  }

  search(query: string, opts: SearchOpts = {}): KbHit[] {
    const expanded = expandQuery(query, opts);
    const m = toMatch(expanded);
    if (!m) return [];
    // Coerce numerics that get interpolated into SQL (bm25 weights, LIMIT) to
    // finite, bounded numbers — never trust raw config/flag values in a SQL string.
    const num = (v: unknown, dflt: number, min: number, max: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
    };
    const fw = opts.fieldWeights;
    const w = {
      headingPath: num(fw?.headingPath, 8, 0, 1000),
      heading: num(fw?.heading, 4, 0, 1000),
      body: num(fw?.body, 1, 0, 1000),
    };
    const limit = num(opts.limit, 10, 1, 1000);
    const wantDedup = opts.dedup !== false;
    const fetch = Math.min(4000, wantDedup ? limit * 4 : limit);
    const where: string[] = ["chunks MATCH ?"];
    const args: any[] = [m];
    if (opts.root) { where.push("root = ?"); args.push(opts.root); }
    if (opts.docType) { where.push("doc_type = ?"); args.push(opts.docType); }
    const sql = `SELECT root, path, chunk_id chunkId, doc_type docType, body_hash bodyHash,
      parent_chunk_id parentChunkId, heading_path headingPath, heading, body,
      bm25(chunks, 0,0,0,0,0,0,0, ${w.headingPath}, ${w.heading}, ${w.body}) score,
      snippet(chunks, 9, '[', ']', ' … ', 12) snippet
      FROM chunks WHERE ${where.join(" AND ")} ORDER BY score LIMIT ${fetch}`;
    const rows = this.db.prepare(sql).all(...args) as any[];

    // bodies for proximity + MMR (dropped before returning)
    const bodies = new Map<string, string>();
    const qterms = tokenize(query);
    let hits: KbHit[] = rows.map((r) => {
      bodies.set(r.chunkId, r.body);
      let score = r.score;
      if (opts.proximityBoost) score += proximityDelta(qterms, r.body);
      return { root: r.root, path: r.path, headingPath: r.headingPath, chunkId: r.chunkId, docType: r.docType, score, snippet: r.snippet, parentChunkId: r.parentChunkId } as KbHit & { parentChunkId: string | null };
    });

    if (wantDedup) {
      // exact-content collapse; prefer higher-priority root, then best score
      const prio = opts.rootPriority ?? {};
      const groups = new Map<string, KbHit[]>();
      for (const h of hits) {
        const key = (rows.find((r) => r.chunkId === h.chunkId) as any).bodyHash;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(h);
      }
      hits = [];
      for (const g of groups.values()) {
        g.sort((a, b) => (prio[b.root] ?? 0) - (prio[a.root] ?? 0) || a.score - b.score);
        const head = g[0];
        if (g.length > 1) head.akaPaths = g.slice(1).map((x) => x.path);
        hits.push(head);
      }
      hits.sort((a, b) => a.score - b.score);
    }

    // lexical MMR diversity (Tier A)
    const div = opts.diversity;
    if (div?.enabled) hits = mmr(hits, bodies, div.lambda, fetch);
    hits = hits.slice(0, limit);

    // optional cross-encoder rerank (Tier C): no-op without an injected reranker
    if (opts.rerank) {
      const rer = opts.reranker;
      if (rer) {
        const reranked = rer(query, hits);
        // search() is sync; only a sync reranker can reorder here. An async
        // reranker (Promise) is ignored — keep BM25 order rather than wipe hits.
        if (!(reranked instanceof Promise)) hits = reranked;
      }
      // no reranker present → clean no-op, BM25 order preserved
    }

    // parent small-to-big (Tier B, on by default)
    if (opts.expandParent) {
      for (const h of hits) {
        const pc = (h as any).parentChunkId as string | null;
        if (!pc) continue;
        const parent = this.getChunkById(h.root, pc);
        if (parent && parent.chunkId !== h.chunkId) {
          h.parent = { root: parent.root, path: parent.path, headingPath: parent.headingPath, chunkId: parent.chunkId, docType: parent.docType, score: 0, snippet: parent.headingPath };
        }
      }
    }
    // drop internal parentChunkId from hits
    return hits.map(({ ...h }) => { delete (h as any).parentChunkId; return h; });
  }

  neighbors(node: string, depth: number, rel?: GraphEdge["rel"]): GraphNode[] {
    const relClause = rel ? "AND e.rel = :rel" : "";
    const sql = `
      WITH RECURSIVE reach(id, d) AS (
        SELECT id, 0 FROM nodes WHERE name = :name
        UNION
        SELECT e.dst, r.d+1 FROM edges e JOIN reach r ON e.src = r.id
        WHERE r.d < :depth ${relClause}
      )
      SELECT DISTINCT n.type, n.name, n.path FROM reach JOIN nodes n USING(id) WHERE n.name != :name`;
    const params: any = { name: node, depth };
    if (rel) params.rel = rel;
    return (this.db.prepare(sql).all(params) as any[]).map((r) => ({ type: r.type, name: r.name, path: r.path }));
  }
  backlinks(node: string): GraphNode[] {
    const sql = `SELECT DISTINCT n.type, n.name, n.path FROM edges e
      JOIN nodes t ON e.dst = t.id JOIN nodes n ON e.src = n.id WHERE t.name = ?`;
    return (this.db.prepare(sql).all(node) as any[]).map((r) => ({ type: r.type, name: r.name, path: r.path }));
  }
  getChunk(root: string, path: string, headingPath?: string): Chunk | null {
    const sql = headingPath
      ? "SELECT * FROM chunks WHERE root=? AND path=? AND heading_path=? LIMIT 1"
      : "SELECT * FROM chunks WHERE root=? AND path=? ORDER BY rowid LIMIT 1";
    const r = (headingPath ? this.db.prepare(sql).get(root, path, headingPath) : this.db.prepare(sql).get(root, path)) as any;
    return r ? rowToChunk(r) : null;
  }
  getChunkById(root: string, chunkId: string): Chunk | null {
    const r = this.db.prepare("SELECT * FROM chunks WHERE root=? AND chunk_id=? LIMIT 1").get(root, chunkId) as any;
    return r ? rowToChunk(r) : null;
  }
  counts() {
    const c = (q: string) => (this.db.prepare(q).get() as any).n as number;
    return {
      files: c("SELECT COUNT(*) n FROM files"),
      chunks: c("SELECT COUNT(*) n FROM chunks"),
      nodes: c("SELECT COUNT(*) n FROM nodes"),
      edges: c("SELECT COUNT(*) n FROM edges"),
    };
  }
}

const STOP = new Set("the for and how what with you your does can from that this are into use using get set all a an of to in on is be as it or by at do".split(" "));
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function rowToChunk(r: any): Chunk {
  return { root: r.root, path: r.path, chunkId: r.chunk_id, headingPath: r.heading_path, heading: r.heading, level: r.level, parentChunkId: r.parent_chunk_id, docType: r.doc_type, body: r.body, bodyHash: r.body_hash };
}

/** Query expansion (Tier C, default off). synonym = curated glossary;
 *  agent = pass-through (caller reformulates); prf = lightweight lexical RM3.
 *  No model dependency. */
function expandQuery(query: string, opts: SearchOpts): string {
  const mode = opts.queryExpansion ?? "off";
  if (mode === "off" || mode === "agent") return query; // agent: caller already reformulated
  const terms = tokenize(query);
  if (mode === "synonym" && opts.synonyms) {
    const extra: string[] = [];
    for (const t of terms) for (const syn of opts.synonyms[t] ?? []) extra.push(syn);
    return extra.length ? query + " " + extra.join(" ") : query;
  }
  return query; // prf handled by callers via a second pass; engine no-ops here
}

/** Proximity/in-order boost: reward hits whose query terms appear close and in
 *  query order in the body. Returns a delta to ADD to the bm25 score (negative
 *  = better). bm25 is asc (lower=better), so a good proximity lowers the score. */
function proximityDelta(queryTerms: string[], body: string): number {
  if (queryTerms.length < 2) return 0;
  const tokens = body.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const pos: Record<string, number[]> = Object.create(null);
  tokens.forEach((t, i) => { (pos[t] ??= []).push(i); });
  // smallest window containing all query terms in order
  let best = Infinity;
  const qt = queryTerms;
  const walk = (idx: number, start: number, span: number): void => {
    if (idx === qt.length) { best = Math.min(best, span); return; }
    const arr = pos[qt[idx]];
    if (!arr) return;
    for (const p of arr) {
      if (p < start) continue;
      walk(idx + 1, p, idx === 0 ? 0 : span + (p - start));
      if (best === 1) return;
    }
  };
  walk(0, -1, 0);
  if (!isFinite(best)) return 0;
  // window 1..~40 → delta 0..-2 (closer = bigger boost)
  return -Math.max(0, 2 - best / 20);
}

/** Lexical MMR diversification over an already-ranked list. */
function mmr(ranked: KbHit[], bodies: Map<string, string>, lambda: number, limit: number): KbHit[] {
  if (ranked.length <= limit) return ranked;
  const tok = (h: KbHit) => new Set(tokenize(bodies.get(h.chunkId) ?? h.headingPath));
  const sets = new Map<string, Set<string>>();
  ranked.forEach((h) => sets.set(h.chunkId, tok(h)));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const uni = a.size + b.size - inter;
    return uni ? inter / uni : 0;
  };
  const out: KbHit[] = [ranked[0]];
  const remaining = ranked.slice(1);
  while (out.length < limit && remaining.length) {
    let bestI = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const h = remaining[i];
      const rel = -h.score; // higher bm25-relevance = better
      let maxSim = 0;
      for (const o of out) maxSim = Math.max(maxSim, jaccard(sets.get(h.chunkId)!, sets.get(o.chunkId)!));
      const score = lambda * rel - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    out.push(remaining.splice(bestI, 1)[0]);
  }
  return out;
}
