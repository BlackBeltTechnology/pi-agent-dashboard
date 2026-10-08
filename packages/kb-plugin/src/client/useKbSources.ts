/**
 * `useKbSources(cwd)` — per-source status (`GET /api/kb/sources`).
 *
 * Refetches ONLY on mount, when `refetch()` is called (after a save / a trust
 * grant), and by the panel on a job running→settled transition. Never on an
 * interval: `/stats` is the polled endpoint; this one is not.
 *
 * See change: improve-kb-settings-sources-and-search (design D7).
 */
import { useCallback, useEffect, useState } from "react";
import type { KbSourceStatus } from "../shared/kb-plugin-types.js";
import { fetchKbSources } from "./kb-api.js";

export function useKbSources(cwd: string | null | undefined): { sources: KbSourceStatus[]; refetch: () => void } {
  const [sources, setSources] = useState<KbSourceStatus[]>([]);
  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` is the refetch trigger (same pattern as useKbConfig).
  useEffect(() => {
    if (!cwd) {
      setSources([]);
      return;
    }
    const ac = new AbortController();
    fetchKbSources(cwd, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setSources(Array.isArray(r?.sources) ? r.sources : []);
      })
      .catch(() => {
        // Status is decoration; a failed fetch keeps the last known badges.
      });
    return () => ac.abort();
  }, [cwd, nonce]);

  return { sources, refetch };
}
