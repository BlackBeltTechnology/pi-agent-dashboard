/**
 * Retriever adapter contract and the harness that enforces it (design M4).
 * A `strict` adapter applies `asOf` and `excludeSessionId` before its limit; the
 * harness is the backstop: it drops (and counts) any hit with no timestamp or
 * one at/after `asOf`, any own-session hit, and any schema-invalid hit.
 */
import { epochMs } from "./util.js";

export interface Hit {
  ref: string;
  text: string;
  sessionId?: string;
  timestamp?: string;
}

export interface SearchQuery {
  query: string;
  asOf: string;
  project: string;
  cwd: string;
  /** Empty string = no exclusion (used only for the own-session-share measurement). */
  excludeSessionId: string;
}

export type SearchResult = Hit[] | { hits: Hit[]; underFill?: boolean };

export interface Retriever {
  id: string;
  version: string;
  asOf: "strict" | "none";
  /** True when hits carry session ids (own-session share is measured for these). */
  sessionBacked?: boolean;
  search(q: SearchQuery): Promise<SearchResult>;
}

export const KEEP_TOP = 5;
export const STORE_TOP = 10;
export const CLIP_CHARS = 260;
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;

export interface KeptHit {
  ref: string;
  text: string;
  sessionId?: string;
  timestamp?: string;
}

export interface CaseResult {
  /** Top 5, post-filter, each clipped to 260 chars. */
  top5: KeptHit[];
  /** Top 10 `(ref, sessionId)` pairs, no text. */
  top10: Array<{ ref: string; sessionId?: string }>;
  error?: string;
  asOfViolations: number;
  invalidHits: number;
  ownSessionDropped: number;
  underFill: boolean;
  /** Unexcluded call: own-session hits among its top 5, and its top-5 size. */
  ownTop5?: { own: number; total: number };
}

function isHit(h: unknown): h is Hit {
  if (!h || typeof h !== "object") return false;
  const o = h as Record<string, unknown>;
  return (
    typeof o.ref === "string" &&
    o.ref.length > 0 &&
    typeof o.text === "string" &&
    (o.sessionId === undefined || typeof o.sessionId === "string") &&
    (o.timestamp === undefined || typeof o.timestamp === "string")
  );
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function callSearch(r: Retriever, q: SearchQuery, timeoutMs: number): Promise<{ hits: unknown[]; underFill: boolean }> {
  const res = await withTimeout(Promise.resolve().then(() => r.search(q)), timeoutMs, `${r.id}.search`);
  if (Array.isArray(res)) return { hits: res, underFill: false };
  return { hits: Array.isArray(res?.hits) ? res.hits : [], underFill: res?.underFill === true };
}

export function filterHits(r: Pick<Retriever, "asOf">, raw: unknown[], asOf: string, ownSession: string | null) {
  let invalid = 0;
  let violations = 0;
  let own = 0;
  const asOfMs = epochMs(asOf);
  const kept: Hit[] = [];
  for (const h of raw) {
    if (!isHit(h)) {
      invalid++;
      continue;
    }
    if (r.asOf === "strict") {
      const t = epochMs(h.timestamp);
      if (t === null || asOfMs === null || t >= asOfMs) {
        violations++;
        continue;
      }
    }
    if (ownSession && h.sessionId === ownSession) {
      own++;
      continue;
    }
    kept.push(h);
  }
  return { kept, invalid, violations, own };
}

/** Run one retriever on one case under the harness checks. Never throws. */
export async function runOne(
  r: Retriever,
  c: { query: string; decisionTime: string; sessionId: string },
  env: { project: string; cwd: string; timeoutMs?: number },
): Promise<CaseResult> {
  const timeoutMs = env.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const base: SearchQuery = { query: c.query, asOf: c.decisionTime, project: env.project, cwd: env.cwd, excludeSessionId: c.sessionId };
  const result: CaseResult = { top5: [], top10: [], asOfViolations: 0, invalidHits: 0, ownSessionDropped: 0, underFill: false };
  try {
    const { hits, underFill } = await callSearch(r, base, timeoutMs);
    const f = filterHits(r, hits, c.decisionTime, c.sessionId);
    result.asOfViolations = f.violations;
    result.invalidHits = f.invalid;
    result.ownSessionDropped = f.own;
    result.underFill = underFill;
    result.top5 = f.kept.slice(0, KEEP_TOP).map((h) => ({ ref: h.ref, text: h.text.slice(0, CLIP_CHARS), ...(h.sessionId ? { sessionId: h.sessionId } : {}), ...(h.timestamp ? { timestamp: h.timestamp } : {}) }));
    result.top10 = f.kept.slice(0, STORE_TOP).map((h) => ({ ref: h.ref, ...(h.sessionId ? { sessionId: h.sessionId } : {}) }));
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
  if (r.sessionBacked) {
    try {
      const { hits } = await callSearch(r, { ...base, excludeSessionId: "" }, timeoutMs);
      const f = filterHits(r, hits, c.decisionTime, null);
      const top = f.kept.slice(0, KEEP_TOP);
      result.ownTop5 = { own: top.filter((h) => h.sessionId === c.sessionId).length, total: top.length };
    } catch {
      /* the share is a secondary figure; a failure here is not a case error */
    }
  }
  return result;
}
