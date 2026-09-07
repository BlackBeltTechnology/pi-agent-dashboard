/**
 * `useKbStats(cwd)` — subscribe to a folder's SHARED KB stats + expose a
 * `reindex()`.
 *
 * The whole state machine (fetch, 1s poll while indexing, MAX_POLL_MISSES
 * tolerance, optimistic `pending` + guard, the two error channels) lives in the
 * module-level per-cwd store (`kb-stats-store.ts`); this hook is a thin
 * `useSyncExternalStore` subscription. Every consumer of the same folder —
 * settings panel, sidebar section, worktree-card section — therefore observes
 * ONE identical snapshot and ONE poll loop.
 *
 * Two DISTINCT error channels (see change: fix-kb-index-feedback):
 *   - `reindexError` — the reindex POST itself was rejected (403/500/transport),
 *     so no job started. Definitive → surface failed + Retry immediately.
 *   - `error` — a `/stats` POLL outage. Resilient: a lone transient miss does
 *     NOT stop polling or set `error`; only a bounded run of consecutive misses
 *     gives up + surfaces.
 * Both are now folder state shared by every consumer, not private to the
 * surface that clicked (design D4).
 *
 * See change: add-kb-folder-slot; fix-kb-card-refresh-and-shared-stats.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { KbStats } from "../shared/kb-plugin-types.js";
import { EMPTY_SNAPSHOT, getKbStatsStore } from "./kb-stats-store.js";

export { MAX_POLL_MISSES, POLL_MS, REINDEX_GUARD_MS, resetKbStatsStores } from "./kb-stats-store.js";

export interface UseKbStatsResult {
  stats: KbStats | null;
  loading: boolean;
  /** `/stats` poll outage, surfaced only after MAX_POLL_MISSES consecutive misses. */
  error: string | null;
  /** The reindex trigger POST was rejected (no job started). */
  reindexError: string | null;
  /**
   * Optimistic click acknowledgement: `true` synchronously from `reindex()` until
   * a definitive outcome (POST reject / a `/stats` poll sees `indexing:true` / the
   * guard elapses). NEVER cleared on the bare `202`. See change: add-kb-index-optimistic-pending.
   */
  pending: boolean;
  reindex: () => void;
  refetch: () => void;
}

const noop = (): void => {};
const noSubscribe = (): (() => void) => noop;
const emptySnapshot = (): typeof EMPTY_SNAPSHOT => EMPTY_SNAPSHOT;

export function useKbStats(cwd: string | null | undefined): UseKbStatsResult {
  // A null cwd has no store entry — the hook stays inert (matches the previous
  // `!cwd` branch).
  const store = cwd ? getKbStatsStore(cwd) : null;

  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(onChange) : noop),
    [store],
  );
  const getSnapshot = useMemo(() => (store ? store.getSnapshot : emptySnapshot), [store]);
  const snapshot = useSyncExternalStore(store ? subscribe : noSubscribe, getSnapshot, getSnapshot);

  const reindex = useCallback(() => store?.reindex(), [store]);
  const refetch = useCallback(() => store?.refetch(), [store]);

  return useMemo(
    () => ({ ...snapshot, reindex, refetch }),
    [snapshot, reindex, refetch],
  );
}
