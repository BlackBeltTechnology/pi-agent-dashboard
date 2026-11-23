/**
 * Pure helpers for `POST /api/file/resolve-mentions` (design D3/D14 of rich-chat-links): request
 * validation, the wire shape of a batch result, a per-principal sliding-window limiter and the one
 * structured log line per request. No filesystem access happens here, so a 400 is decided before any
 * path is touched; the route wires admission and `resolveMentionTagged` around these.
 *
 * Wire: `{ cwd, items: [{ mention, toolCwd?, reRooted? }] }` → `{ results: BatchResult[] }`, same order and
 * length as `items`. Items past {@link MAX_BATCH_ITEMS} come back `{ state: "unknown" }` (the client asks
 * again in a later flush). A `gated` item carries NOTHING but its state, so two out-of-scope mentions are
 * byte-identical whether or not the file exists.
 */
import crypto from "node:crypto";
import type { TaggedMention } from "./resolve-file-mention.js";

export const MAX_BATCH_ITEMS = 200;
export const MAX_FIELD_CHARS = 1024;
export const BATCH_BODY_LIMIT_BYTES = 512 * 1024;
export const BATCH_RATE_PER_MINUTE = 60;

interface BatchItem {
  mention: string;
  toolCwd?: string;
  reRooted?: string;
}

/** Per-item wire result. `unknown` = not processed (past the cap); everything else is a {@link TaggedMention} state. */
export interface BatchResult {
  state: TaggedMention["state"] | "unknown";
  resolved?: string;
  kind?: NonNullable<TaggedMention["kind"]>;
  via?: NonNullable<TaggedMention["via"]>;
  candidates?: string[];
}

/** `items` holds at most {@link MAX_BATCH_ITEMS} entries; `total` is the request's full item count (the rest are answered `unknown`). */
export type BatchParse = { ok: true; cwd: string; items: BatchItem[]; total: number } | { ok: false; error: string };

type ItemParse = { ok: true; item: BatchItem } | { ok: false; error: string };

/** Validate one untrusted item: shape first, then the bound on every string field. */
function parseBatchItem(raw: unknown): ItemParse {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "each item must be an object" };
  const { mention, toolCwd, reRooted } = raw as Record<string, unknown>;
  if (typeof mention !== "string") return { ok: false, error: "each item needs a string mention" };
  for (const field of [mention, toolCwd, reRooted]) {
    if (field !== undefined && typeof field !== "string") return { ok: false, error: "toolCwd and reRooted must be strings" };
    if (typeof field === "string" && field.length > MAX_FIELD_CHARS) {
      return { ok: false, error: `a field exceeds ${MAX_FIELD_CHARS} characters` };
    }
  }
  return {
    ok: true,
    item: { mention, ...(toolCwd ? { toolCwd: toolCwd as string } : {}), ...(reRooted ? { reRooted: reRooted as string } : {}) },
  };
}

/**
 * Validate the untrusted body. Every string field of every item is bounded, including items past the
 * cap — but those are only checked, never materialised (a 512 KB body of tiny items stays cheap).
 */
export function parseBatchBody(body: unknown): BatchParse {
  const b = (typeof body === "object" && body !== null ? body : {}) as { cwd?: unknown; items?: unknown };
  if (typeof b.cwd !== "string" || b.cwd === "") return { ok: false, error: "cwd and items are required" };
  if (!Array.isArray(b.items)) return { ok: false, error: "cwd and items are required" };
  const items: BatchItem[] = [];
  const raws = b.items as unknown[];
  for (let i = 0; i < raws.length; i++) {
    const parsed = parseBatchItem(raws[i]);
    if (!parsed.ok) return parsed;
    if (i < MAX_BATCH_ITEMS) items.push(parsed.item);
  }
  return { ok: true, cwd: b.cwd, items, total: raws.length };
}

/** Wire form of a tagged result for the batch: no `resolved: null`, and `gated` reveals nothing beyond its state. */
export function toBatchResult(t: TaggedMention): BatchResult {
  if (t.state === "gated" || t.state === "missing") return { state: t.state };
  return {
    state: t.state,
    ...(t.resolved !== null ? { resolved: t.resolved } : {}),
    ...(t.kind ? { kind: t.kind } : {}),
    ...(t.via ? { via: t.via } : {}),
    ...(t.candidates ? { candidates: t.candidates } : {}),
  };
}

/** Items resolved at once. Small and fixed: enough to overlap filesystem latency, never a thundering herd. */
export const BATCH_CONCURRENCY = 16;

/** `Promise.all(items.map(fn))` with at most `limit` in flight; results keep input order. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const WINDOW_MS = 60_000;
const MAX_LIMITER_KEYS = 1000;

/** Sliding-window limiter, `limit` takes per 60 s per key. Bounded: the least recently used key is evicted. */
export function createWindowLimiter(limit: number, now: () => number = Date.now): { take(key: string): boolean } {
  const hits = new Map<string, number[]>();
  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > MAX_LIMITER_KEYS) hits.delete(hits.keys().next().value as string);
      if (recent.length >= limit) return false;
      recent.push(t);
      return true;
    },
  };
}

export interface BatchLogFacts {
  cwd: string;
  items: number;
  counts: Partial<Record<BatchResult["state"], number>>;
  fuzzy: { hit: number; miss: number; skipped: number; buildMs: number };
  stats: number;
  totalMs: number;
}

/** One line per request. Carries a cwd hash and counts only — never a mention, path or directory. */
export function formatBatchLog(f: BatchLogFacts): string {
  const cwdHash = crypto.createHash("sha256").update(f.cwd).digest("hex").slice(0, 8);
  const c = (s: BatchResult["state"]): number => f.counts[s] ?? 0;
  return (
    `[resolve-mentions] cwd=${cwdHash} items=${f.items} found=${c("found")} recovered=${c("recovered")} ` +
    `ambiguous=${c("ambiguous")} missing=${c("missing")} gated=${c("gated")} unknown=${c("unknown")} ` +
    `fuzzy_hit=${f.fuzzy.hit} fuzzy_miss=${f.fuzzy.miss} fuzzy_skipped=${f.fuzzy.skipped} ` +
    `index_build_ms=${Math.round(f.fuzzy.buildMs)} stats=${f.stats} total_ms=${Math.round(f.totalMs)}`
  );
}
