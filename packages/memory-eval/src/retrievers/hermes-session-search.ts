/**
 * As-of replicas of hermes `searchSessions` (newest-first) and its BM25-ordered
 * variant, plus `searchMemories`. Hermes ranking and query cascade, plus an
 * in-query `asOf` bound and own-session exclusion applied BEFORE the limit, so
 * later or own-session rows never take result slots.
 * See change: add-memory-eval-tier-r (design M4).
 */
import type { DatabaseSync } from "node:sqlite";
import {
  buildFallbackFts5Query,
  buildNaturalLanguageFallbackQuery,
  collectLikeTerms,
  hasExplicitFts5Operator,
  isFts5QueryError,
  normalizeFts5Query,
  normalizeNaturalLanguageFts5Query,
} from "./hermes-fts-query.js";

export interface SessionRow {
  id: string;
  session_id: string;
  project: string;
  role: string;
  content: string;
  timestamp: string;
}

export interface SessionSearchOpts {
  project?: string;
  /** ISO-8601 UTC; rows with `timestamp >= asOf` are excluded in-query. */
  asOf?: string;
  excludeSessionId?: string;
  limit?: number;
}

export const BM25_WINDOW = 5_000;
export const BM25_WIDE_WINDOW = 50_000;

export interface SessionSearchResult {
  rows: SessionRow[];
  /** BM25 only: the first window was saturated and the eligible rows still fell short of the limit. */
  underFill: boolean;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const COLS = "m.id, m.session_id, s.project, m.role, m.content, m.timestamp";

type Match = { type: "fts"; query: string } | { type: "like"; terms: string[] };

function filters(o: SessionSearchOpts): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (o.project) {
    sql.push("s.project = ?");
    params.push(o.project);
  }
  if (o.asOf) {
    sql.push("m.timestamp < ?");
    params.push(o.asOf);
  }
  if (o.excludeSessionId) {
    sql.push("m.session_id <> ?");
    params.push(o.excludeSessionId);
  }
  return { sql, params };
}

/** Newest-first (hermes order) or BM25-first with a bounded FTS window. */
export function searchSessionsReplica(db: DatabaseSync, query: string, o: SessionSearchOpts, order: "recent" | "bm25"): SessionSearchResult {
  const limit = o.limit ?? 10;
  if (query.trim().length === 0) return { rows: [], underFill: false };
  let ftsParseError = false;
  let underFill = false;

  const runLike = (terms: string[]): SessionRow[] => {
    if (!terms.length) return [];
    const f = filters(o);
    const conds = [`(${terms.map(() => "m.content LIKE ? ESCAPE '\\'").join(" OR ")})`, ...f.sql];
    const params = [...terms.map((t) => `%${escapeLike(t)}%`), ...f.params];
    return db
      .prepare(`SELECT ${COLS} FROM messages m JOIN sessions s ON s.id = m.session_id WHERE ${conds.join(" AND ")} ORDER BY m.timestamp DESC LIMIT ?`)
      .all(...(params as never[]), limit) as unknown as SessionRow[];
  };

  const runFtsRecent = (q: string): SessionRow[] => {
    const f = filters(o);
    const conds = ["m.rowid IN (SELECT rowid FROM message_fts WHERE message_fts MATCH ?)", ...f.sql];
    return db
      .prepare(`SELECT ${COLS} FROM messages m JOIN sessions s ON s.id = m.session_id WHERE ${conds.join(" AND ")} ORDER BY m.timestamp DESC LIMIT ?`)
      .all(...([q, ...f.params] as never[]), limit) as unknown as SessionRow[];
  };

  // Rank inside FTS first (bounded window), then join and filter. Putting the
  // as-of join inside the ranked query is the 9-48 s v0 plan.
  const runFtsBm25 = (q: string): SessionRow[] => {
    const f = filters(o);
    const where = f.sql.length ? `WHERE ${f.sql.join(" AND ")}` : "";
    const stmt = (window: number) =>
      db
        .prepare(
          `WITH hits AS (SELECT rowid AS rid, rank AS r FROM message_fts WHERE message_fts MATCH ? ORDER BY rank LIMIT ${window})
           SELECT ${COLS} FROM hits JOIN messages m ON m.rowid = hits.rid JOIN sessions s ON s.id = m.session_id ${where} ORDER BY hits.r LIMIT ?`,
        )
        .all(...([q, ...f.params] as never[]), limit) as unknown as SessionRow[];
    const count = (window: number) =>
      Number((db.prepare(`SELECT COUNT(*) AS n FROM (SELECT rowid FROM message_fts WHERE message_fts MATCH ? LIMIT ${window})`).get(q) as { n: number }).n);
    let rows = stmt(BM25_WINDOW);
    if (rows.length < limit && count(BM25_WINDOW) >= BM25_WINDOW) {
      rows = stmt(BM25_WIDE_WINDOW);
      underFill = rows.length < limit;
    }
    return rows;
  };

  const runFts = (q: string): SessionRow[] => {
    try {
      return order === "recent" ? runFtsRecent(q) : runFtsBm25(q);
    } catch (err) {
      if (isFts5QueryError(err)) {
        ftsParseError = true;
        return [];
      }
      throw err;
    }
  };
  const done = (rows: SessionRow[]): SessionSearchResult => ({ rows, underFill });

  const normalized = normalizeFts5Query(query);
  if (!normalized) return done(runLike(collectLikeTerms(query)));
  const exact = runFts(normalized);
  if (exact.length > 0) return done(exact);

  if (hasExplicitFts5Operator(query)) {
    if (!ftsParseError) return done(exact);
    const nl = normalizeNaturalLanguageFts5Query(query);
    if (nl.length > 0 && nl !== normalized) {
      const r = runFts(nl);
      if (r.length > 0) return done(r);
      const fb = buildNaturalLanguageFallbackQuery(query);
      if (fb && fb !== nl) {
        const r2 = runFts(fb);
        if (r2.length > 0) return done(r2);
      }
    }
    return done(runLike(collectLikeTerms(query)));
  }

  const fallback = buildFallbackFts5Query(query);
  if (fallback && fallback !== normalized) {
    const r = runFts(fallback);
    if (r.length > 0) return done(r);
  }
  return done(runLike(collectLikeTerms(query)));
}

export interface MemoryRow {
  id: number;
  project: string | null;
  target: string;
  content: string;
  created: string;
}

/**
 * hermes `searchMemories` with project-or-global scope and eligibility
 * `created < date(asOf UTC)`: `created` is a day, so same-day memories are
 * excluded (their order against the case is unknowable).
 */
export function searchMemoriesReplica(db: DatabaseSync, query: string, o: { project?: string; asOf?: string; limit?: number }): MemoryRow[] {
  const limit = o.limit ?? 10;
  if (query.trim().length === 0) return [];
  const f: string[] = [];
  const fp: unknown[] = [];
  if (o.project) {
    f.push("(m.project = ? OR m.project IS NULL)");
    fp.push(o.project);
  }
  if (o.asOf) {
    f.push("m.created < ?");
    fp.push(new Date(o.asOf).toISOString().slice(0, 10));
  }
  let ftsParseError = false;
  const cols = "m.id, m.project, m.target, m.content, m.created";
  const runFts = (q: string): MemoryRow[] => {
    try {
      const conds = ["memory_fts MATCH ?", ...f];
      return db
        .prepare(`SELECT ${cols}, bm25(memory_fts) AS rank_score FROM memories m JOIN memory_fts ON memory_fts.rowid = m.id WHERE ${conds.join(" AND ")} ORDER BY rank_score ASC, m.last_referenced DESC LIMIT ?`)
        .all(...([q, ...fp] as never[]), limit) as unknown as MemoryRow[];
    } catch (err) {
      if (isFts5QueryError(err)) {
        ftsParseError = true;
        return [];
      }
      throw err;
    }
  };
  const runLike = (terms: string[]): MemoryRow[] => {
    if (!terms.length) return [];
    const conds = [`(${terms.map(() => "m.content LIKE ? ESCAPE '\\'").join(" OR ")})`, ...f];
    return db
      .prepare(`SELECT ${cols} FROM memories m WHERE ${conds.join(" AND ")} ORDER BY m.last_referenced DESC LIMIT ?`)
      .all(...([...terms.map((t) => `%${escapeLike(t.trim())}%`), ...fp] as never[]), limit) as unknown as MemoryRow[];
  };
  const normalized = normalizeFts5Query(query);
  if (!normalized) return runLike(collectLikeTerms(query));
  const exact = runFts(normalized);
  if (exact.length > 0) return exact;
  if (ftsParseError) {
    const nl = normalizeNaturalLanguageFts5Query(query);
    if (!nl || nl === normalized) return [];
    const r = runFts(nl);
    if (r.length > 0) return r;
    const fb = buildNaturalLanguageFallbackQuery(query);
    return fb && fb !== nl ? runFts(fb) : r;
  }
  const fb = buildFallbackFts5Query(query);
  return !fb || fb === normalized ? exact : runFts(fb);
}
