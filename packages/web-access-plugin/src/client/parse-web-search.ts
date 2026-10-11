/**
 * Pure parsing for the web-access card (`web-search-results` custom entries
 * emitted by `pi-web-access`).
 *
 * Everything here is TOTAL: the payload is untrusted third-party input, so no
 * function throws. Counts are only reported when they are provably complete
 * (under-reporting is safe; over-reporting is not).
 *
 * See change: render-unclaimed-custom-entries (design D3).
 */
import { CUSTOM_BODY_MAX_CHARS } from "./body-limits.js";

export const MAX_QUERIES = 20;
export const MAX_RESULTS_PER_QUERY = 20;
export const MAX_FETCH_URLS = 50;

/** Marker `truncateOutputForDisplay` prefixes when earlier lines were dropped. */
const LINE_TRUNCATION_MARKER = /^«\d+ earlier lines hidden»\n/;

export interface BodySummary {
  /** Recognised payload subtype; absent when unknown / unparseable. */
  type?: "search" | "fetch";
  queries?: number;
  results?: number;
  urls?: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Collapsed-line summary derived from the stored row body ONLY (no fetch).
 * A count appears only when the matching value is actually an array — ingest
 * either keeps an array whole (exact length) or replaces it with a string.
 */
export function summarizeBody(body: string): BodySummary {
  try {
    if (LINE_TRUNCATION_MARKER.test(body) || body.length >= CUSTOM_BODY_MAX_CHARS) return {};
    const parsed: unknown = JSON.parse(body);
    if (!isObject(parsed)) return {};
    if (parsed.type === "search") {
      const out: BodySummary = { type: "search" };
      const queries = parsed.queries;
      if (Array.isArray(queries)) {
        out.queries = queries.length;
        if (queries.every((q) => isObject(q) && Array.isArray(q.results))) {
          out.results = queries.reduce<number>((n, q) => n + ((q as { results: unknown[] }).results.length), 0);
        }
      }
      return out;
    }
    if (parsed.type === "fetch") {
      const out: BodySummary = { type: "fetch" };
      if (Array.isArray(parsed.urlMetadata)) out.urls = parsed.urlMetadata.length;
      else if (Array.isArray(parsed.urls)) out.urls = parsed.urls.length;
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export interface ResultView {
  title: string;
  url: string;
  snippet: string;
}

export interface QueryView {
  query: string;
  /** Joined `providers[]`, else `provider`, else "". */
  providers: string;
  answer: string | null;
  error: string | null;
  results: ResultView[];
  omittedResults: number;
}

export interface SearchView {
  kind: "search";
  queries: QueryView[];
  omittedQueries: number;
  /** Malformed entries that could not be displayed. */
  skipped: number;
}

export interface FetchItem {
  url: string;
  title: string;
  size: number | null;
  error: string | null;
}

export interface FetchView {
  kind: "fetch";
  items: FetchItem[];
  omitted: number;
  skipped: number;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseSearch(p: Record<string, unknown>): SearchView | null {
  if (!Array.isArray(p.queries)) return null;
  let skipped = 0;
  const queries: QueryView[] = [];
  for (const q of p.queries.slice(0, MAX_QUERIES)) {
    if (!isObject(q)) {
      skipped++;
      continue;
    }
    const rawResults = q.results;
    const results: ResultView[] = [];
    let omittedResults = 0;
    if (Array.isArray(rawResults)) {
      omittedResults = Math.max(0, rawResults.length - MAX_RESULTS_PER_QUERY);
      for (const r of rawResults.slice(0, MAX_RESULTS_PER_QUERY)) {
        if (!isObject(r) || typeof r.url !== "string") {
          skipped++;
          continue;
        }
        results.push({ title: str(r.title) ?? r.url, url: r.url, snippet: str(r.snippet) ?? "" });
      }
    } else if (rawResults !== undefined) {
      skipped++;
    }
    const providers = Array.isArray(q.providers)
      ? q.providers.filter((x): x is string => typeof x === "string").join(", ")
      : (str(q.provider) ?? "");
    queries.push({
      query: str(q.query) ?? "",
      providers,
      answer: str(q.answer),
      error: str(q.error),
      results,
      omittedResults,
    });
  }
  return { kind: "search", queries, omittedQueries: Math.max(0, p.queries.length - MAX_QUERIES), skipped };
}

function parseFetch(p: Record<string, unknown>): FetchView | null {
  const raw = Array.isArray(p.urlMetadata) ? p.urlMetadata : Array.isArray(p.urls) ? p.urls : null;
  if (!raw) return null;
  let skipped = 0;
  const items: FetchItem[] = [];
  for (const u of raw.slice(0, MAX_FETCH_URLS)) {
    if (!isObject(u) || typeof u.url !== "string") {
      skipped++;
      continue;
    }
    const size =
      typeof u.contentLength === "number" ? u.contentLength : typeof u.content === "string" ? u.content.length : null;
    items.push({ url: u.url, title: str(u.title) ?? u.url, size, error: str(u.error) });
  }
  return { kind: "fetch", items, omitted: Math.max(0, raw.length - MAX_FETCH_URLS), skipped };
}

/** Typed view of a full payload; `null` for research / unknown / garbage. Never throws. */
export function parseWebSearchPayload(payload: unknown): SearchView | FetchView | null {
  try {
    if (!isObject(payload)) return null;
    if (payload.type === "search") return parseSearch(payload);
    if (payload.type === "fetch") return parseFetch(payload);
    return null;
  } catch {
    return null;
  }
}

/**
 * `href` for a link-safe URL, else `null`. Only http(s) without embedded
 * credentials qualifies; the caller renders the ORIGINAL text with the
 * normalized `href` as target.
 */
export function safeHttpUrl(raw: string): string | null {
  try {
    if (typeof raw !== "string") return null;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username !== "" || u.password !== "") return null;
    return u.href;
  } catch {
    return null;
  }
}
