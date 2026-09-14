/**
 * Per-key lazy cache for archived-session listings.
 *
 * Key space: `<groupPath>` for a folder's fold, `q:<text>` for a search.
 * The query params derive from the key (prefix `q:` → `q=`, else `cwd=`), so
 * the caller never passes params twice. First page is cached per key;
 * `invalidate` drops the cache so the next `loadFirst` refetches (used when
 * `session_archived` / `archived_count_updated` arrives for a folder).
 * Debounce / search timing lives in the caller (SessionList).
 *
 * See change: archive-sessions-lazy-load.
 */
import { useCallback, useRef, useState } from "react";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { fetchArchivedSessions } from "../lib/api/archived-sessions-api.js";

export const ARCHIVE_PAGE_SIZE = 50;

export interface ArchivedKeyState {
  items: ArchivedSessionSummary[];
  nextCursor?: string;
  loading: boolean;
  error?: string;
  /** True once a first page has loaded successfully (cache guard). */
  loaded: boolean;
}

const EMPTY_STATE: ArchivedKeyState = { items: [], loading: false, loaded: false };

type Cache = Record<string, ArchivedKeyState>;

function paramsForKey(key: string, cursor?: string) {
  return key.startsWith("q:")
    ? { q: key.slice(2), limit: ARCHIVE_PAGE_SIZE, ...(cursor ? { cursor } : {}) }
    : { cwd: key, limit: ARCHIVE_PAGE_SIZE, ...(cursor ? { cursor } : {}) };
}

export function useArchivedSessions() {
  const [cache, setCache] = useState<Cache>({});
  // Latest-cache mirror: guards inside async callbacks read the freshest
  // state without re-subscribing on every cache change.
  const cacheRef = useRef<Cache>({});
  cacheRef.current = cache;

  const patch = useCallback((key: string, partial: Partial<ArchivedKeyState>) => {
    setCache((prev) => {
      const current = prev[key] ?? EMPTY_STATE;
      return { ...prev, [key]: { ...current, ...partial } };
    });
  }, []);

  /** Fetch one page and REPLACE (first) or APPEND (more) it under `key`. */
  const runPage = useCallback(
    (key: string, opts: { append: boolean }) => {
      const current = cacheRef.current[key];
      patch(key, { loading: true, error: undefined });
      fetchArchivedSessions(paramsForKey(key, current?.nextCursor))
        .then((page) => {
          setCache((prev) => {
            const existing = prev[key] ?? EMPTY_STATE;
            return {
              ...prev,
              [key]: {
                items: opts.append ? [...existing.items, ...page.items] : page.items,
                nextCursor: page.nextCursor,
                loading: false,
                loaded: true,
                error: undefined,
              },
            };
          });
        })
        .catch((err: unknown) => {
          patch(key, { loading: false, loaded: opts.append ? true : false, error: err instanceof Error ? err.message : String(err) });
        });
    },
    [patch],
  );

  const loadFirst = useCallback(
    (key: string) => {
      const current = cacheRef.current[key];
      if (current?.loading || current?.loaded) return;
      runPage(key, { append: false });
    },
    [runPage],
  );

  const loadMore = useCallback(
    (key: string) => {
      const current = cacheRef.current[key];
      if (!current || current.loading || !current.loaded) return;
      // Exhausted: no cursor while items are held (an empty first page with a
      // remaining count still offers Load-more, which lands here and refetches).
      if (current.items.length > 0 && current.nextCursor === undefined) return;
      runPage(key, { append: true });
    },
    [runPage],
  );

  const retry = useCallback(
    (key: string) => {
      const current = cacheRef.current[key];
      if (current?.loading) return;
      runPage(key, { append: false });
    },
    [runPage],
  );

  const invalidate = useCallback((key: string) => {
    if (!(key in cacheRef.current)) return;
    // Update the ref SYNCHRONOUSLY so an immediate loadFirst(key) in the
    // same tick (open fold refetch on count change) sees `loaded:false`.
    const next = { ...cacheRef.current, [key]: EMPTY_STATE };
    cacheRef.current = next;
    setCache(next);
  }, []);

  const get = useCallback((key: string): ArchivedKeyState => cache[key] ?? EMPTY_STATE, [cache]);

  return { get, loadFirst, loadMore, retry, invalidate };
}
