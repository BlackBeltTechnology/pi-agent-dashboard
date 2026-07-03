/**
 * `useKbStats(cwd)` — fetch a folder's KB stats + expose a `reindex()`.
 *
 * Fetches once on mount / cwd change. While a job is `indexing`, polls
 * `/stats` every second and stops when indexing completes (or errors). No WS
 * subscription in v1 (parity with `useGoals`). See change: add-kb-folder-slot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KbStats } from "../shared/kb-plugin-types.js";
import { fetchKbStats, reindexKb } from "./kb-api.js";

const POLL_MS = 1000;

export interface UseKbStatsResult {
  stats: KbStats | null;
  loading: boolean;
  error: string | null;
  reindex: () => void;
  refetch: () => void;
}

export function useKbStats(cwd: string | null | undefined): UseKbStatsResult {
  const [stats, setStats] = useState<KbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    const load = (): void => {
      fetchKbStats(cwd, ac.signal)
        .then((s) => {
          if (ac.signal.aborted) return;
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
          setError(e instanceof Error ? e.message : String(e));
          clearPoll();
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
    setError(null);
    reindexKb(cwd)
      .then(() => refetch())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [cwd, refetch]);

  return { stats, loading, error, reindex, refetch };
}
