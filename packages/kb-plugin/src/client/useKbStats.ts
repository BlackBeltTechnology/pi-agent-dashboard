/**
 * `useKbStats(cwd)` — fetch a folder's KB stats + expose a `reindex()`.
 *
 * Fetches once on mount / cwd change. While a job is `indexing`, polls `/stats`
 * every second and stops when indexing completes.
 *
 * Two DISTINCT error channels (see change: fix-kb-index-feedback):
 *   - `reindexError` — the reindex POST itself was rejected (403/500/transport),
 *     so no job started. Definitive → surface failed + Retry immediately.
 *   - `error` — a `/stats` POLL outage. Resilient: a lone transient miss does
 *     NOT stop polling or set `error` (so a live walk keeps its spinner); only a
 *     bounded run of consecutive misses (`MAX_POLL_MISSES`) gives up + surfaces.
 * See change: add-kb-folder-slot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KbStats } from "../shared/kb-plugin-types.js";
import { fetchKbStats, reindexKb } from "./kb-api.js";

const POLL_MS = 1000;
/** Consecutive `/stats` failures tolerated before giving up + surfacing `error`. */
const MAX_POLL_MISSES = 3;

export interface UseKbStatsResult {
  stats: KbStats | null;
  loading: boolean;
  /** `/stats` poll outage, surfaced only after MAX_POLL_MISSES consecutive misses. */
  error: string | null;
  /** The reindex trigger POST was rejected (no job started). */
  reindexError: string | null;
  reindex: () => void;
  refetch: () => void;
}

export function useKbStats(cwd: string | null | undefined): UseKbStatsResult {
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const missRef = useRef(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!cwd) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    missRef.current = 0;

    const load = (): void => {
      fetchKbStats(cwd, ac.signal)
        .then((s) => {
          if (ac.signal.aborted) return;
          missRef.current = 0; // a success resets the miss run
          setError(null);
          setStats(s);
          // Poll only while a job is running; stop as soon as it settles.
          if (s.indexing && !pollRef.current) {
            pollRef.current = setInterval(load, POLL_MS);
          } else if (!s.indexing) {
            clearPoll();
          }
        })
        .catch((e) => {
          if (ac.signal.aborted) return;
          missRef.current += 1;
          if (missRef.current >= MAX_POLL_MISSES) {
            // Genuine outage — give up and surface (a persistent "stats unavailable").
            setError(e instanceof Error ? e.message : String(e));
            clearPoll();
          } else if (!pollRef.current) {
            // Transient miss with no active interval (e.g. initial load hiccup):
            // schedule a retry so one blip does not abandon the fetch.
            pollRef.current = setInterval(load, POLL_MS);
          }
          // If an interval is already running, it keeps retrying — the spinner
          // survives because `stats` (indexing:true) is left untouched.
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    };
    load();

    return () => {
      ac.abort();
      clearPoll();
    };
  }, [cwd, nonce, clearPoll]);

  const reindex = useCallback(() => {
    if (!cwd) return;
    setReindexError(null);
    reindexKb(cwd)
      .then(() => refetch()) // 202 → refetch engages the /stats poll (sees indexing:true)
      .catch((e) => setReindexError(e instanceof Error ? e.message : String(e)));
  }, [cwd, refetch]);

  return { stats, loading, error, reindexError, reindex, refetch };
}
