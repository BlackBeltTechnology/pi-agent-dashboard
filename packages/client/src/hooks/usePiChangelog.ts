/**
 * Hook for fetching the parsed changelog of a core package between
 * two versions.
 *
 * Lazy: when `enabled` is false the hook does not issue any request
 * and returns `{ data: null, loading: false, error: null }`. When
 * `enabled` flips to true (or the version range changes), a fetch
 * fires once and the result is cached in component state.
 *
 * Refetch triggers:
 *   - `enabled`, `pkg`, `from`, or `to` change.
 *   - A `pi_core_update_complete` WS message arrives for the same
 *     `pkg` (dispatched as a `pi-core-event` CustomEvent by
 *     `useMessageHandler`).
 *
 * Errors are surfaced via the `error` field — the hook never throws.
 *
 * See change: pi-update-whats-new-panel.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchPiChangelog } from "../lib/api/pi-core-api.js";
import type { ChangelogResponse } from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

export interface UsePiChangelogResult {
  data: ChangelogResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export interface UsePiChangelogOptions {
  enabled: boolean;
}

export function usePiChangelog(
  pkg: string,
  from: string | undefined,
  to: string | undefined,
  opts: UsePiChangelogOptions,
): UsePiChangelogResult {
  const [data, setData] = useState<ChangelogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(
    (signal?: AbortSignal) => {
      if (!opts.enabled || !pkg || !from || !to) {
        // Reset state so stale data doesn't linger when conditions
        // change to disabled.
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      fetchPiChangelog(pkg, from, to, signal)
        .then((resp) => {
          if (!mountedRef.current) return;
          setData(resp);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
          if ((err as { name?: string })?.name === "AbortError") return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (mountedRef.current) setLoading(false);
        });
    },
    [opts.enabled, pkg, from, to],
  );

  // Initial fetch + refetch on dep changes.
  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    doFetch(ac.signal);
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [doFetch]);

  // Refetch on pi-core update complete WS event for THIS package.
  useEffect(() => {
    if (!opts.enabled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { type?: string; results?: Array<{ name: string; success?: boolean }> }
        | undefined;
      if (!detail || detail.type !== "pi_core_update_complete") return;
      if (!Array.isArray(detail.results)) return;
      const matched = detail.results.some((r) => r.name === pkg);
      if (matched) doFetch();
    };
    window.addEventListener("pi-core-event", handler);
    return () => window.removeEventListener("pi-core-event", handler);
  }, [opts.enabled, pkg, doFetch]);

  const refresh = useCallback(() => doFetch(), [doFetch]);

  return { data, loading, error, refresh };
}
