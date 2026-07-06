import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 30_000;

/**
 * Fetch discovered pi resources for a folder. Pass `cwd` for a folder scope
 * (local+global). Pass `{ globalOnly: true }` (global Settings surface) to fetch
 * without a cwd — the server scans its own cwd but the caller reads only
 * `data.global`. See change: resources-card-tabs.
 */
export function usePiResources(cwd: string | null, opts?: { globalOnly?: boolean }) {
  const globalOnly = opts?.globalOnly === true;
  const [data, setData] = useState<PiResourcesResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sentinel drives the effect + stale-guard in global-only mode (no cwd).
  const target = globalOnly ? "\u0000global" : cwd;
  const cwdRef = useRef(target);
  cwdRef.current = target;

  const fetchResources = useCallback(async (targetCwd: string, forceRefresh = false) => {
    try {
      const isGlobal = targetCwd === "\u0000global";
      const url = isGlobal
        ? `/api/pi-resources${forceRefresh ? "?refresh=true" : ""}`
        : `/api/pi-resources?cwd=${encodeURIComponent(targetCwd)}${forceRefresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      const body = await res.json();
      if (cwdRef.current !== targetCwd) return; // stale
      if (body.success) {
        setData(body.data);
        setError(null);
      } else {
        setError(body.error ?? "Failed to fetch pi resources");
      }
    } catch (err: any) {
      if (cwdRef.current !== targetCwd) return;
      setError(err.message ?? "Network error");
    }
  }, []);

  useEffect(() => {
    if (!target) {
      setData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    fetchResources(target).finally(() => setIsLoading(false));

    const timer = setInterval(() => fetchResources(target), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [target, fetchResources]);

  const refresh = useCallback(() => {
    if (target) {
      setIsLoading(true);
      fetchResources(target, true).finally(() => setIsLoading(false));
    }
  }, [target, fetchResources]);

  return { data, isLoading, error, refresh };
}
