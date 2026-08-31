// Default KbStore backend over node:sqlite (Node built-in; FTS5 verified).
// Zero runtime deps. Requires --experimental-sqlite on current Node.
// better-sqlite3 is a drop-in fallback behind the same KbStore interface.

import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Chunk, FileState, Filter, GraphEdge, GraphNode, KbHit, KbStore, SearchOpts, StorePropertyRow } from "./types.js";

/** Bump when the frontmatter structural schema/behavior changes so an existing
 *  DB force-reindexes once on open (design D6). */
export const SCHEMA_VERSION = 2;

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
CREATE TABLE IF NOT EXISTS properties (
  root TEXT, path TEXT, key TEXT,
  value TEXT, value_num REAL, value_date TEXT, value_raw TEXT
);
-- The unique index doubles as the (root,path) lookup for delete-by-path (its
-- leading columns), so no separate idx_props_path is needed — one fewer index to
-- maintain on the hot per-file insert path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_props_uniq ON properties(root, path, key, value);
CREATE INDEX IF NOT EXISTS idx_props_kv ON properties(key, value);
CREATE TABLE IF NOT EXISTS kb_meta (k TEXT PRIMARY KEY, v TEXT);
`;

/** Build correlated EXISTS predicates for facet filters. All values are bound as
 *  parameters (never interpolated) — SQL-injection guard (design D7). */
function buildFilterClauses(filters: Filter[] | undefined, outer: string): { clauses: string[]; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  const norm = (v: unknown) => String(v).toLowerCase().trim();
  // Match column for equality by declared type: number→value_num, date→value_date,
  // else the normalized string value (the parser may pre-coerce numeric scalars,
  // so eq on a typed key must not compare the lossy string column).
  const eqCol = (t?: string) => (t === "number" ? "value_num" : t === "date" ? "value_date" : "value");
  const eqVal = (t: string | undefined, v: unknown) => (t === "number" ? Number(v) : t === "date" ? String(v) : norm(v));
  for (const f of filters ?? []) {
    if (f.op === "eq" && f.value != null) {
      const col = eqCol(f.type);
      clauses.push(`EXISTS (SELECT 1 FROM properties p WHERE p.root=${outer}.root AND p.path=${outer}.path AND p.key=? AND p.${col}=?)`);
      args.push(f.key, eqVal(f.type, f.value));
    } else if (f.op === "in" && f.values?.length) {
      const col = eqCol(f.type);
      const ph = f.values.map(() => "?").join(",");
      clauses.push(`EXISTS (SELECT 1 FROM properties p WHERE p.root=${outer}.root AND p.path=${outer}.path AND p.key=? AND p.${col} IN (${ph}))`);
      args.push(f.key, ...f.values.map((v) => eqVal(f.type, v)));
    } else if ((f.op === "gte" || f.op === "lte") && f.value != null) {
      const col = f.type === "number" ? "value_num" : f.type === "date" ? "value_date" : "value";
      const cmp = f.op === "gte" ? ">=" : "<=";
      clauses.push(`EXISTS (SELECT 1 FROM properties p WHERE p.root=${outer}.root AND p.path=${outer}.path AND p.key=? AND p.${col} IS NOT NULL AND p.${col} ${cmp} ?)`);
      args.push(f.key, f.type === "number" ? Number(f.value) : f.type === "date" ? String(f.value) : norm(f.value));
    }
  }
  return { clauses, args };
}

// FTS5 query builder: OR the alphanumeric terms (recall + BM25 ranks).
function toMatch(q: string): string {
  const terms = tokenize(q);
  const kept = terms.length ? terms : (q.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
  return kept.map((t) => `"${t}"`).join(" OR ");
}

export class SqliteFtsStore implements KbStore {
  private db: DatabaseSync;
  readonly dbPath: string;
  // Prepared-statement cache: re-preparing per row on a hot insert path (chunks
  // + properties, many per file) is a measurable reindex cost. Cache by SQL.
  private stmts = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  private prep(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
  constructor(dbPath: string) {
    this.dbPath = dbPath;
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
    // An index batch just changed the corpus; cached document frequencies (and
    // therefore IDF) are stale. The fts5vocab view itself is live.
    this.dfCache.clear();
  }
  rollback() {
    try {
      this.db.exec("ROLLBACK");
    } catch {}
  }
  close() {
    this.db.close();
  }
  /** Finalize a temp-path build onto `dest`. WAL ordering is load-bearing:
   *  TRUNCATE-checkpoint + close BEFORE the rename so the single main file holds
   *  every committed page; then rename atomically and drop stale sidecars.
   *  See change: harden-kb-index-failure-atomicity. */
  finalizeRename(dest: string) {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    this.db.close();
    renameSync(this.dbPath, dest);
    for (const ext of ["-wal", "-shm"]) {
      try {
        unlinkSync(this.dbPath + ext);
      } catch {}
    }
  }
  /** Close and remove this DB file + WAL sidecars — cleanup for a failed run
   *  that itself created the file (never touches a pre-existing valid DB). */
  closeAndUnlink() {
    try {
      this.db.close();
    } catch {}
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(this.dbPath + ext);
      } catch {}
    }
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
    this.dfCache.clear();
    // chunks includes the file's synthetic `:meta` chunk (same path) — removed here.
    this.db.prepare("DELETE FROM chunks WHERE root=? AND path=?").run(root, path);
    // outbound edges originate from this file's nodes; prune nodes owned by path then dangling edges
    const owned = this.db.prepare("SELECT id FROM nodes WHERE path=?").all(path) as any[];
    for (const n of owned) this.db.prepare("DELETE FROM edges WHERE src=? OR dst=?").run(n.id, n.id);
    this.db.prepare("DELETE FROM nodes WHERE path=?").run(path);
    this.db.prepare("DELETE FROM properties WHERE root=? AND path=?").run(root, path);
    this.db.prepare("DELETE FROM files WHERE root=? AND path=?").run(root, path);
  }

  deletePropertiesByPath(root: string, path: string) {
    this.db.prepare("DELETE FROM properties WHERE root=? AND path=?").run(root, path);
  }
  insertProperty(r: StorePropertyRow) {
    // INSERT OR IGNORE + UNIQUE(root,path,key,value) de-dups within-file duplicates.
    this.prep("INSERT OR IGNORE INTO properties(root,path,key,value,value_num,value_date,value_raw) VALUES(?,?,?,?,?,?,?)").run(r.root, r.path, r.key, r.value, r.valueNum, r.valueDate, r.valueRaw);
  }
  facets(keys: string[], opts: { root?: string; filters?: Filter[] } = {}): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    if (!keys.length) return out;
    const where: string[] = [`key IN (${keys.map(() => "?").join(",")})`];
    const args: unknown[] = [...keys];
    if (opts.root) { where.push("o.root = ?"); args.push(opts.root); }
    const f = buildFilterClauses(opts.filters, "o");
    where.push(...f.clauses);
    args.push(...f.args);
    // Distinct FILES, not rows: two sources with the same relative path are two
    // files, so count distinct (root,path) — within-file duplicates already
    // collapse via the UNIQUE(root,path,key,value) index.
    const sql = `SELECT key, value, COUNT(DISTINCT root || char(31) || path) n FROM properties o WHERE ${where.join(" AND ")} GROUP BY key, value`;
    for (const r of this.db.prepare(sql).all(...(args as any[])) as any[]) {
      (out[r.key] ??= {})[r.value] = r.n as number;
    }
    return out;
  }
  getUserVersion(): number {
    return (this.db.prepare("PRAGMA user_version").get() as any).user_version as number;
  }
  setUserVersion(v: number) {
    // PRAGMA does not accept a bound parameter; v is an internal integer constant.
    this.db.exec(`PRAGMA user_version = ${Math.trunc(v)}`);
  }
  getMeta(k: string): string | null {
    const r = this.db.prepare("SELECT v FROM kb_meta WHERE k=?").get(k) as any;
    return r ? (r.v as string) : null;
  }
  setMeta(k: string, v: string) {
    this.db.prepare("INSERT INTO kb_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
  }

  insertChunk(c: Chunk) {
    this.prep("INSERT INTO chunks(root,path,chunk_id,doc_type,parent_chunk_id,level,body_hash,heading_path,heading,body) VALUES(?,?,?,?,?,?,?,?,?,?)")
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

  /** Porter stems for raw tokens, computed by SQLite's OWN tokenizer so they
   *  match what FTS5 actually indexed. A raw token is NOT a usable key into the
   *  vocab table: FTS5 stores `collaps`, and no prefix range anchored at
   *  `collapsed` can reach a key that sorts BEFORE it. The helper tables live in
   *  `temp.`, so this works against a read-only main DB. */
  private stemReady: boolean | null = null;
  private stemCache = new Map<string, string>();
  private stems(tokens: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const missing = [...new Set(tokens.filter((t) => !this.stemCache.has(t)))];
    if (this.stemReady === null) {
      try {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.kb_stem USING fts5(t, tokenize='porter unicode61')");
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.kb_stem_vocab USING fts5vocab(kb_stem, 'instance')");
        this.stemReady = true;
      } catch {
        this.stemReady = false;
      }
    }
    if (this.stemReady && missing.length) {
      try {
        this.db.exec("DELETE FROM temp.kb_stem");
        const ins = this.db.prepare("INSERT INTO temp.kb_stem(rowid, t) VALUES(?,?)");
        missing.forEach((t, i) => ins.run(i + 1, t));
        // 'instance' carries the source rowid, so each stem maps back to its token.
        for (const r of this.db.prepare("SELECT term, doc FROM temp.kb_stem_vocab").all() as any[]) {
          const tok = missing[(Number(r.doc) || 0) - 1];
          if (tok !== undefined) this.stemCache.set(tok, String(r.term));
        }
      } catch { /* stemming unavailable → fall back to the raw token below */ }
    }
    for (const t of tokens) out.set(t, this.stemCache.get(t) ?? t);
    return out;
  }

  /** Corpus document frequency for raw tokens, via the fts5vocab shadow table.
   *  Keys are exact porter stems (see `stems()`), so df is exact rather than a
   *  prefix over-estimate. `fts5vocab` is a live view over the FTS index, but
   *  `dfCache` is not — it is dropped on `commit()`/`deleteByPath`, the points at
   *  which an index batch can have moved the counts. Falls back to df=0 when the
   *  vocab table cannot be created (e.g. a read-only DB). */
  private dfCache = new Map<string, number>();
  private vocabReady: boolean | null = null;
  private documentFrequencies(tokens: string[]): Map<string, number> {
    const out = new Map<string, number>();
    const stem = this.stems(tokens);
    const keys = [...new Set(tokens.map((t) => stem.get(t) as string))];
    const missing = keys.filter((k) => !this.dfCache.has(k));
    if (this.vocabReady === null) {
      try {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vocab USING fts5vocab(chunks, 'row')");
        this.vocabReady = true;
      } catch {
        this.vocabReady = false;
      }
    }
    if (this.vocabReady && missing.length) {
      const ph = missing.map(() => "?").join(",");
      try {
        const rows = this.db.prepare(`SELECT term, doc FROM chunks_vocab WHERE term IN (${ph})`).all(...missing) as any[];
        for (const k of missing) this.dfCache.set(k, 0); // absent term = df 0
        for (const r of rows) this.dfCache.set(String(r.term), Number(r.doc) || 0);
      } catch { /* vocab unusable → leave uncached, treated as df 0 below */ }
    }
    for (const t of tokens) out.set(t, this.dfCache.get(stem.get(t) as string) ?? 0);
    return out;
  }

  /** IDF weights for the given tokens over the current corpus. */
  private idf(tokens: string[]): Map<string, number> {
    const n = Math.max(1, this.counts().chunks);
    const df = this.documentFrequencies(tokens);
    const out = new Map<string, number>();
    for (const t of tokens) out.set(t, Math.log(1 + n / (1 + (df.get(t) ?? 0))));
    return out;
  }

  search(query: string, opts: SearchOpts = {}): KbHit[] {
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
    const wantSourceDedup = opts.sourceDedup !== false;
    // Coverage rerank is opt-IN: measured a net regression on the bundled
    // fixtures. See openspec/changes/fix-kb-search-retrieval-quality/measurements.md.
    const wantCoverage = opts.coverageRerank === true;
    // Source dedup collapses many sections of one file into one slot, so a pool
    // sized at `limit` would starve the page — fetch a multiple of `limit`
    // (design D2), still bounded by the pre-existing 4000 ceiling.
    const fetch = Math.min(4000, wantSourceDedup ? limit * 6 : wantDedup ? limit * 4 : limit);
    const qterms = tokenize(query);

    // --- one BM25 pass, optionally restricted to a doc-type lane -------------
    const pass = (match: string, docType?: string, depth = fetch): any[] => {
      const where: string[] = ["chunks MATCH ?"];
      const args: any[] = [match];
      if (opts.root) { where.push("root = ?"); args.push(opts.root); }
      if (docType) { where.push("doc_type = ?"); args.push(docType); }
      // structured facet filters (opt-in; absent → no clause → identical query)
      const ff = buildFilterClauses(opts.filters, "chunks");
      where.push(...ff.clauses);
      args.push(...ff.args);
      const sql = `SELECT root, path, chunk_id chunkId, doc_type docType, body_hash bodyHash,
      parent_chunk_id parentChunkId, heading_path headingPath, heading, body,
      bm25(chunks, 0,0,0,0,0,0,0, ${w.headingPath}, ${w.heading}, ${w.body}) score,
      snippet(chunks, 9, '[', ']', ' … ', 12) snippet
      FROM chunks WHERE ${where.join(" AND ")} ORDER BY score LIMIT ${depth}`;
      return this.db.prepare(sql).all(...args) as any[];
    };

    // --- query expansion ------------------------------------------------------
    // PRF is engine-side (design D4) and is applied ONLY with coverage rerank on:
    // expanding an OR-query deepens the very dilution the rerank exists to cure
    // (measured: PRF alone P@5 0.366 → 0.297).
    const mode = opts.queryExpansion ?? "off";
    let match = toMatch(expandQuery(query, opts));
    if (!match) return [];
    let extraTerms: string[] = [];
    if (mode === "prf" && wantCoverage) {
      extraTerms = this.prfTerms(query, qterms, pass(match, opts.docType), opts);
      if (extraTerms.length) match = toMatch(`${query} ${extraTerms.join(" ")}`);
    }

    // --- lanes ----------------------------------------------------------------
    // An `agents` chunk is 3.2% of the index and ~3x longer than a `doc` chunk,
    // so BM25 length normalisation buries the per-file record layer ~30:1. The
    // fix is engine-side: rank an `agents` lane separately and interleave a
    // reserved share of the page (design D3). An explicit docType bypasses it.
    const laneShare = opts.docType ? 0 : Math.min(1, Math.max(0, Number(opts.laneQuota ?? 0.5) || 0));
    const mainRows = pass(match, opts.docType);
    // Same depth as the main lane. A shallower pool would be cheaper only in
    // theory: `doc_type` is an UNINDEXED FTS5 column, so this pass scans the
    // whole match set regardless of LIMIT. It would, however, make
    // `suppressedSections` depend on WHICH lane surfaced a source — an `agents`
    // file with more matching sections than the shallow pool would under-report.
    const agentsRows = laneShare > 0 ? pass(match, "agents") : [];

    // The lead rule (design D2) compares each lane's best RAW BM25(+proximity)
    // score. Neither MMR nor `coverageRerank` mutates `score` — they only
    // reorder — and the capture below is a MIN over the lane, so it is
    // reorder-invariant by construction. Reading `hits[0].score` instead would
    // NOT be: `coverageRerank` fully re-sorts, so its head is not the
    // best-scoring candidate. The min is what makes the position moot.
    const bodies = new Map<string, string>();
    const lane = (rows: any[], captureRawBest?: (best: number) => void): KbHit[] => {
      let hits: KbHit[] = rows.map((r) => {
        bodies.set(r.chunkId, r.body);
        let score = r.score;
        if (opts.proximityBoost) score += proximityDelta(qterms, r.body);
        return { root: r.root, path: r.path, headingPath: r.headingPath, chunkId: r.chunkId, docType: r.docType, score, snippet: r.snippet, parentChunkId: r.parentChunkId } as KbHit & { parentChunkId: string | null };
      });

      if (wantDedup) {
        // exact-content collapse; prefer higher-priority root, then best score.
        // Runs FIRST so `akaPaths` is computed against the full candidate set —
        // source dedup then operates over already-collapsed hits (design D1).
        const prio = opts.rootPriority ?? {};
        const byChunk = new Map<string, any>(rows.map((r) => [r.chunkId, r]));
        const groups = new Map<string, KbHit[]>();
        for (const h of hits) {
          const key = byChunk.get(h.chunkId).bodyHash;
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

      if (wantSourceDedup) {
        // One slot per (root, path); representative = best (lowest) BM25 score;
        // the rest become a per-source count the render surfaces.
        const groups = new Map<string, KbHit[]>();
        for (const h of hits) {
          const key = `${h.root}\u001f${h.path}`;
          (groups.get(key) ?? groups.set(key, []).get(key)!).push(h);
        }
        hits = [];
        for (const g of groups.values()) {
          g.sort((a, b) => a.score - b.score);
          const head = g[0];
          head.suppressedSections = g.length - 1;
          hits.push(head);
        }
        hits.sort((a, b) => a.score - b.score);
      }

      if (captureRawBest && hits.length) captureRawBest(hits.reduce((b, h) => Math.min(b, h.score), Number.POSITIVE_INFINITY));

      // lexical MMR diversity (Tier A)
      const div = opts.diversity;
      if (div?.enabled) hits = mmr(hits, bodies, div.lambda, fetch);
      if (wantCoverage) hits = this.coverageRerank(hits, bodies, qterms, extraTerms);
      return hits;
    };

    // Lead-slot rule (change fix-kb-search-lane-composition, design D1/D2). The
    // running-share quota cannot ever take slot 1 — `(0+1)/(0+1) <= share` is
    // false for every share < 1 — so rank 1 gets its own knob. `0` = off.
    const leadMargin = Math.min(1, Math.max(0, Number(opts.laneLeadMargin ?? 0) || 0));
    let mainBest = Number.NaN;
    let reservedBest = Number.NaN;
    const main = lane(mainRows, (b) => { mainBest = b; });
    let hits: KbHit[];
    if (laneShare > 0 && agentsRows.length) {
      const reserved = lane(agentsRows, (b) => { reservedBest = b; });
      // Sign-safe relative margin: scores are negative and ascending-better, so
      // a ratio test would invert across the sign boundary. At margin 1 this
      // reduces to `r0 <= 0` — an unconditional lead, the documented degenerate
      // endpoint.
      // NOTE the decision/pick asymmetry under `coverageRerank` (default OFF):
      // the decision reads the lane's raw BEST, while the pick is
      // `reserved[0]` — the lane's own head, which a coverage re-sort may have
      // moved off that best. Deliberate: the lane's internal ordering is the
      // lane's business, and the rule only decides WHICH lane leads. Both
      // knobs are opt-in, so the interaction is spot-checked (D6), not shipped.
      const leadFirst =
        leadMargin > 0 &&
        Number.isFinite(mainBest) &&
        Number.isFinite(reservedBest) &&
        reservedBest - mainBest <= leadMargin * Math.abs(mainBest);
      hits = interleaveLanes(main, reserved, laneShare, limit, wantSourceDedup, leadFirst);
    } else {
      hits = main.slice(0, limit);
    }

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
          // Collapse to headingPath only: root/path/docType dup the child (same
          // file by construction), score is a constant 0, snippet repeats
          // headingPath, chunkId is not a tool refetch key. See change: slim-kb-search-output.
          h.parent = { headingPath: parent.headingPath };
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
  /** Fetch a chunk by path (+ optional section). A path-only fetch of a
   *  multi-chunk file returns the FIRST chunk plus a `suppressedSections` count
   *  — it must never silently hand back one arbitrary slice of N (design D7). */
  getChunk(root: string, path: string, headingPath?: string): Chunk | null {
    if (headingPath) {
      const r = this.db.prepare("SELECT * FROM chunks WHERE root=? AND path=? AND heading_path=? LIMIT 1").get(root, path, headingPath) as any;
      return r ? rowToChunk(r) : null;
    }
    const r = this.db.prepare("SELECT * FROM chunks WHERE root=? AND path=? ORDER BY rowid LIMIT 1").get(root, path) as any;
    if (!r) return null;
    const n = (this.db.prepare("SELECT COUNT(*) n FROM chunks WHERE root=? AND path=?").get(root, path) as any).n as number;
    return { ...rowToChunk(r), suppressedSections: Math.max(0, n - 1) };
  }

  /** All chunks of a file in document order — the non-truncating companion to a
   *  path-only `getChunk`. */
  getChunks(root: string, path: string): Chunk[] {
    return (this.db.prepare("SELECT * FROM chunks WHERE root=? AND path=? ORDER BY rowid").all(root, path) as any[]).map(rowToChunk);
  }

  /** Rerank by IDF-weighted coverage of the ORIGINAL query terms, BM25 as the
   *  tiebreak. PRF-appended terms count at half weight so expansion can never
   *  dominate the sort (design D4). */
  private coverageRerank(hits: KbHit[], bodies: Map<string, string>, qterms: string[], extraTerms: string[]): KbHit[] {
    if (!qterms.length || hits.length < 2) return hits;
    const all = [...qterms, ...extraTerms];
    const idf = this.idf(all);
    const cov = new Map<string, number>();
    for (const h of hits) {
      const toks = new Set(tokenize(`${h.headingPath} ${bodies.get(h.chunkId) ?? ""}`));
      let c = 0;
      for (const t of qterms) if (hasStem(toks, t)) c += idf.get(t) ?? 0;
      for (const t of extraTerms) if (hasStem(toks, t)) c += 0.5 * (idf.get(t) ?? 0);
      cov.set(h.chunkId, c);
    }
    return [...hits].sort((a, b) => (cov.get(b.chunkId)! - cov.get(a.chunkId)!) || a.score - b.score);
  }

  /** RM3-style pseudo-relevance feedback: mine the top candidates of a first
   *  pass for terms absent from the query and below the corpus-frequency
   *  ceiling, rank by freq × IDF, return the top `terms` (design D4). */
  private prfTerms(query: string, qterms: string[], firstPass: any[], opts: SearchOpts): string[] {
    const cfg = opts.prf ?? {};
    const want = Math.max(0, Math.trunc(cfg.terms ?? 6));
    const topK = Math.max(1, Math.trunc(cfg.topK ?? 10));
    const ceiling = Math.min(1, Math.max(0, cfg.dfCeiling ?? 0.1));
    // RM3 needs a feedback SET. When the first pass returns only a handful of
    // candidates the "top-k relevant" docs are simply the whole corpus, so the
    // mined terms carry no discriminating signal and only dilute the OR-query.
    if (!want || firstPass.length < MIN_FEEDBACK_DOCS) return [];
    const seen = new Set(qterms);
    const freq = new Map<string, number>();
    for (const r of firstPass.slice(0, topK)) {
      for (const t of tokenize(`${r.headingPath} ${r.body}`)) {
        if (seen.has(t)) continue;
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    // Bound the df round trip: only the most frequent feedback candidates.
    const cands = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t);
    if (!cands.length) return [];
    const n = Math.max(1, this.counts().chunks);
    const df = this.documentFrequencies(cands);
    return cands
      .filter((t) => (df.get(t) ?? 0) / n <= ceiling)
      .map((t) => [t, (freq.get(t) ?? 0) * Math.log(1 + n / (1 + (df.get(t) ?? 0)))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, want)
      .map(([t]) => t);
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

/** Minimum first-pass candidates before PRF mining is meaningful (design D4). */
const MIN_FEEDBACK_DOCS = 5;

const STOP = new Set("the for and how what with you your does can from that this are into use using get set all a an of to in on is be as it or by at do".split(" "));
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function rowToChunk(r: any): Chunk {
  return { root: r.root, path: r.path, chunkId: r.chunk_id, headingPath: r.heading_path, heading: r.heading, level: r.level, parentChunkId: r.parent_chunk_id, docType: r.doc_type, body: r.body, bodyHash: r.body_hash };
}

/** Query expansion (Tier C). synonym = curated glossary; off/agent =
 *  pass-through (the caller already reformulated). `prf` is NOT handled here:
 *  it needs a first retrieval pass, so `search()` owns it (design D4).
 *  No model dependency. */
function expandQuery(query: string, opts: SearchOpts): string {
  const mode = opts.queryExpansion ?? "off";
  if (mode !== "synonym" || !opts.synonyms) return query;
  const extra: string[] = [];
  for (const t of tokenize(query)) for (const syn of opts.synonyms[t] ?? []) extra.push(syn);
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}

/** Stem-tolerant membership: FTS5 indexes porter stems while `tokenize()`
 *  yields raw tokens, so `collapsed` must count as covering `collapse`.
 *  The prefix arm is bounded to a shared stem of at least STEM_MIN characters —
 *  an unbounded prefix test saturates coverage (every candidate "covers" every
 *  short term) and collapses the rerank into noise. */
const STEM_MIN = 4;
function hasStem(tokens: Set<string>, term: string): boolean {
  if (tokens.has(term)) return true;
  if (term.length < STEM_MIN) return false;
  for (const t of tokens) {
    if (t.length < STEM_MIN) continue;
    if (t.startsWith(term) || term.startsWith(t)) return true;
  }
  return false;
}

/** Interleave a reserved-share lane with the unrestricted lane (design D3).
 *  A source already emitted by either lane is never repeated, and a lane that
 *  runs dry yields its remaining slots to the other. */
function interleaveLanes(main: KbHit[], reserved: KbHit[], share: number, limit: number, dedupSources: boolean, leadFirst = false): KbHit[] {
  const out: KbHit[] = [];
  const seen = new Set<string>();
  let mi = 0;
  let ri = 0;
  let taken = 0;
  // The lanes overlap (the unrestricted lane also sees `agents` chunks), so a
  // source taken by one lane is skipped in the other — but only when the caller
  // asked for source dedup at all.
  const next = (arr: KbHit[], i: number): number => {
    if (!dedupSources) return i;
    while (i < arr.length && seen.has(`${arr[i].root}\u001f${arr[i].path}`)) i++;
    return i;
  };
  while (out.length < limit) {
    mi = next(main, mi);
    ri = next(reserved, ri);
    const mHas = mi < main.length;
    const rHas = ri < reserved.length;
    if (!mHas && !rHas) break;
    // Slot 1 is decided by the lead rule; slots 2..N by the running share.
    // The lead pick is an ordinary reserved take — it increments `taken` and
    // populates `seen`, so slot 2 then reads `2/2 = 1 > share` and yields.
    const wantReserved = rHas && (!mHas || (out.length === 0 && leadFirst) || (taken + 1) / (out.length + 1) <= share);
    const pick = wantReserved ? reserved[ri++] : main[mi++];
    if (wantReserved) taken++;
    if (dedupSources) seen.add(`${pick.root}\u001f${pick.path}`);
    out.push(pick);
  }
  return out;
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
