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

interface SessionRow {
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

const BM25_WINDOW = 5_000;
const BM25_WIDE_WINDOW = 50_000;

export interface SessionSearchResult {
  rows: SessionRow[];
  /** BM25 only: the first window was saturated and the eligible rows still fell short of the limit. */
  underFill: boolean;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const COLS = "m.id, m.session_id, s.project, m.role, m.content, m.timestamp";

function filters(o: SessionSearchOpts): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    sql.push(cond);
    params.push(v);
  };
  if (o.project) add("s.project = ?", o.project);
  // Compare instants, not strings: stored timestamps may carry any ISO-8601 offset.
  if (o.asOf) add("julianday(m.timestamp) < julianday(?)", o.asOf);
  if (o.excludeSessionId) add("m.session_id <> ?", o.excludeSessionId);
  return { sql, params };
}

function likeRows(db: DatabaseSync, terms: string[], o: SessionSearchOpts, limit: number): SessionRow[] {
  if (!terms.length) return [];
  const f = filters(o);
  const conds = [`(${terms.map(() => "m.content LIKE ? ESCAPE '\\'").join(" OR ")})`, ...f.sql];
  const params = [...terms.map((t) => `%${escapeLike(t)}%`), ...f.params];
  return db
    .prepare(`SELECT ${COLS} FROM messages m JOIN sessions s ON s.id = m.session_id WHERE ${conds.join(" AND ")} ORDER BY m.timestamp DESC LIMIT ?`)
    .all(...(params as never[]), limit) as unknown as SessionRow[];
}

function ftsRecentRows(db: DatabaseSync, q: string, o: SessionSearchOpts, limit: number): SessionRow[] {
  const f = filters(o);
  const conds = ["m.rowid IN (SELECT rowid FROM message_fts WHERE message_fts MATCH ?)", ...f.sql];
  return db
    .prepare(`SELECT ${COLS} FROM messages m JOIN sessions s ON s.id = m.session_id WHERE ${conds.join(" AND ")} ORDER BY m.timestamp DESC LIMIT ?`)
    .all(...([q, ...f.params] as never[]), limit) as unknown as SessionRow[];
}

/**
 * Rank inside FTS first (bounded window), then join and filter. Putting the
 * as-of join inside the ranked query is the 9-48 s v0 plan.
 */
function ftsBm25Rows(db: DatabaseSync, q: string, o: SessionSearchOpts, limit: number): { rows: SessionRow[]; underFill: boolean } {
  const f = filters(o);
  const where = f.sql.length ? `WHERE ${f.sql.join(" AND ")}` : "";
  const windowed = (window: number) =>
    db
      .prepare(
        `WITH hits AS (SELECT rowid AS rid, rank AS r FROM message_fts WHERE message_fts MATCH ? ORDER BY rank LIMIT ${window})
         SELECT ${COLS} FROM hits JOIN messages m ON m.rowid = hits.rid JOIN sessions s ON s.id = m.session_id ${where} ORDER BY hits.r LIMIT ?`,
      )
      .all(...([q, ...f.params] as never[]), limit) as unknown as SessionRow[];
  const saturated = () => Number((db.prepare(`SELECT COUNT(*) AS n FROM (SELECT rowid FROM message_fts WHERE message_fts MATCH ? LIMIT ${BM25_WINDOW})`).get(q) as { n: number }).n) >= BM25_WINDOW;
  let rows = windowed(BM25_WINDOW);
  if (rows.length >= limit || !saturated()) return { rows, underFill: false };
  rows = windowed(BM25_WIDE_WINDOW);
  return { rows, underFill: rows.length < limit };
}

/** FTS queries to try after the exact one, in order (null = skipped). Hermes semantics. */
function alternativeQueries(query: string, normalized: string): Array<string | null> {
  if (!hasExplicitFts5Operator(query)) {
    const fallback = buildFallbackFts5Query(query);
    return [fallback && fallback !== normalized ? fallback : null];
  }
  const nl = normalizeNaturalLanguageFts5Query(query);
  if (nl.length === 0 || nl === normalized) return [];
  const nlFallback = buildNaturalLanguageFallbackQuery(query);
  return [nl, nlFallback && nlFallback !== nl ? nlFallback : null];
}

/** The hermes query cascade over an injected FTS/LIKE runner. */
function cascade<T>(query: string, run: { fts(q: string): T[]; like(terms: string[]): T[]; parseError(): boolean }): T[] {
  const normalized = normalizeFts5Query(query);
  if (!normalized) return run.like(collectLikeTerms(query));
  const exact = run.fts(normalized);
  // A valid operator query that matches nothing keeps its exact semantics; only a parse error recovers.
  if (exact.length > 0 || (hasExplicitFts5Operator(query) && !run.parseError())) return exact;
  for (const alt of alternativeQueries(query, normalized)) {
    const r = alt ? run.fts(alt) : [];
    if (r.length > 0) return r;
  }
  return run.like(collectLikeTerms(query));
}

/** Newest-first (hermes order) or BM25-first with a bounded FTS window. */
export function searchSessionsReplica(db: DatabaseSync, query: string, o: SessionSearchOpts, order: "recent" | "bm25"): SessionSearchResult {
  const limit = o.limit ?? 10;
  if (query.trim().length === 0) return { rows: [], underFill: false };
  let parseError = false;
  let underFill = false;
  const rows = cascade<SessionRow>(query, {
    like: (terms) => likeRows(db, terms, o, limit),
    parseError: () => parseError,
    fts(q) {
      try {
        if (order === "recent") return ftsRecentRows(db, q, o, limit);
        const r = ftsBm25Rows(db, q, o, limit);
        underFill = r.underFill;
        return r.rows;
      } catch (err) {
        if (!isFts5QueryError(err)) throw err;
        parseError = true;
        return [];
      }
    },
  });
  return { rows, underFill };
}

export interface MemoryRow {
  id: number;
  project: string | null;
  target: string;
  content: string;
  created: string;
}

function memoryFilters(o: { project?: string; asOf?: string }): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (o.project) {
    sql.push("(m.project = ? OR m.project IS NULL)");
    params.push(o.project);
  }
  if (o.asOf) {
    sql.push("m.created < ?");
    params.push(new Date(o.asOf).toISOString().slice(0, 10));
  }
  return { sql, params };
}

const MEMORY_COLS = "m.id, m.project, m.target, m.content, m.created";

/**
 * hermes `searchMemories` with project-or-global scope and eligibility
 * `created < date(asOf UTC)`: `created` is a day, so same-day memories are
 * excluded (their order against the case is unknowable).
 */
export function searchMemoriesReplica(db: DatabaseSync, query: string, o: { project?: string; asOf?: string; limit?: number }): MemoryRow[] {
  const limit = o.limit ?? 10;
  if (query.trim().length === 0) return [];
  const f = memoryFilters(o);
  let parseError = false;
  const fts = (q: string): MemoryRow[] => {
    try {
      const conds = ["memory_fts MATCH ?", ...f.sql];
      return db
        .prepare(`SELECT ${MEMORY_COLS}, bm25(memory_fts) AS rank_score FROM memories m JOIN memory_fts ON memory_fts.rowid = m.id WHERE ${conds.join(" AND ")} ORDER BY rank_score ASC, m.last_referenced DESC LIMIT ?`)
        .all(...([q, ...f.params] as never[]), limit) as unknown as MemoryRow[];
    } catch (err) {
      if (!isFts5QueryError(err)) throw err;
      parseError = true;
      return [];
    }
  };
  const like = (terms: string[]): MemoryRow[] => {
    if (!terms.length) return [];
    const conds = [`(${terms.map(() => "m.content LIKE ? ESCAPE '\\'").join(" OR ")})`, ...f.sql];
    return db
      .prepare(`SELECT ${MEMORY_COLS} FROM memories m WHERE ${conds.join(" AND ")} ORDER BY m.last_referenced DESC LIMIT ?`)
      .all(...([...terms.map((t) => `%${escapeLike(t.trim())}%`), ...f.params] as never[]), limit) as unknown as MemoryRow[];
  };
  const normalized = normalizeFts5Query(query);
  if (!normalized) return like(collectLikeTerms(query));
  const exact = fts(normalized);
  if (exact.length > 0) return exact;
  if (parseError) {
    const nl = normalizeNaturalLanguageFts5Query(query);
    if (!nl || nl === normalized) return [];
    const r = fts(nl);
    const fb = buildNaturalLanguageFallbackQuery(query);
    return r.length > 0 || !fb || fb === nl ? r : fts(fb);
  }
  const fb = buildFallbackFts5Query(query);
  return !fb || fb === normalized ? exact : fts(fb);
}
