/**
 * Shared per-cwd cache for `GET /api/openspec-archive`. One fetch per folder
 * while the folder's active-change signature is unchanged, the listing is
 * < 5 min old, and (after a failure) < 30 s have elapsed. Concurrent readers
 * share one in-flight request.
 * See change: resolve-archived-attached-proposal (D4).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import { getApiBase } from "../api/api-context.js";
import { t } from "../i18n/i18n.js";
import type { ArchiveState } from "./resolve-attachment.js";

const ARCHIVE_TTL_MS = 5 * 60_000;
const ARCHIVE_RETRY_MS = 30_000;

export interface ArchiveCacheState extends ArchiveState {
  error?: string;
}

interface Entry {
  status: "loading" | "ok" | "error";
  entries: ArchiveEntry[];
  error?: string;
  /** Active-set signature this listing belongs to; null = not yet known. */
  sig: string | null;
  fetchedAt: number;
  token: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let tokenSeq = 0;

const IDLE: ArchiveCacheState = { status: "idle", entries: [] };
const LOADING: ArchiveCacheState = { status: "loading", entries: [] };

function notify(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeArchiveCache(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getArchiveCacheVersion(): number {
  return version;
}

/** Sorted active change names — the invalidation key. */
export function activeSignature(names: readonly string[]): string {
  return [...names].sort().join(",");
}

/** Read the cached state for `cwd`. A listing for a different signature reads as loading. */
export function getArchiveState(cwd: string, sig: string | null): ArchiveCacheState {
  const e = cache.get(cwd);
  if (!e) return IDLE;
  if (sig !== null && e.sig !== null && e.sig !== sig) return LOADING;
  if (e.status === "loading") return LOADING;
  return { status: e.status, entries: e.entries, error: e.error };
}

/** Is a cached entry still good for `sig` at `now`? */
function isFresh(e: Entry, sig: string | null, now: number): boolean {
  if (sig !== null && e.sig !== null && e.sig !== sig) return false;
  if (e.status === "loading") return true;
  if (e.status === "ok") return now - e.fetchedAt < ARCHIVE_TTL_MS;
  return now - e.fetchedAt < ARCHIVE_RETRY_MS;
}

/** Start a fetch for `cwd` if the cache is missing, stale, or due for retry. Idempotent. */
export function requestArchive(cwd: string, sig: string | null): void {
  const now = Date.now();
  const e = cache.get(cwd);
  if (e) {
    if (e.sig === null && sig !== null) e.sig = sig; // adopt first real signature
    if (isFresh(e, sig, now)) return;
  }
  const token = ++tokenSeq;
  const prevEntries = e?.entries ?? [];
  cache.set(cwd, { status: "loading", entries: prevEntries, sig: sig ?? e?.sig ?? null, fetchedAt: now, token });
  const fail = (message: string) => {
    const cur = cache.get(cwd);
    if (!cur || cur.token !== token) return;
    cache.set(cwd, { ...cur, status: "error", entries: [], error: message, fetchedAt: Date.now() });
    notify();
  };
  let request: Promise<Response>;
  try {
    request = fetch(`${getApiBase()}/api/openspec-archive?cwd=${encodeURIComponent(cwd)}`);
  } catch (err) {
    request = Promise.reject(err);
  }
  request
    .then((res) => res.json())
    .then((body) => {
      const cur = cache.get(cwd);
      if (!cur || cur.token !== token) return;
      if (!body.success) {
        fail(body.error ?? t("archive.fetchFailed", undefined, "Failed to fetch archive"));
        return;
      }
      cache.set(cwd, { ...cur, status: "ok", entries: body.data, error: undefined, fetchedAt: Date.now() });
      notify();
    })
    .catch((err) => fail(err?.message ?? t("archive.fetchFailed", undefined, "Failed to fetch archive")));
  notify();
}

/** Test helper. */
export function __resetArchiveCache(): void {
  cache.clear();
  listeners.clear();
  version = 0;
}
