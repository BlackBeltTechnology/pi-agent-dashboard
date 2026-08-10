/**
 * Hook for the dashboard's curated recommended-extensions list.
 *
 * Fetches GET /api/packages/recommended on mount and whenever a package
 * install / remove / update operation completes successfully (via the
 * `pi-package-event` window event broadcast by the dashboard server).
 */

import type { EnrichedRecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

export interface UseRecommendedExtensionsResult {
  recommended: EnrichedRecommendedExtension[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRecommendedExtensions(): UseRecommendedExtensionsResult {
  const [recommended, setRecommended] = useState<EnrichedRecommendedExtension[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchRecommended = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/packages/recommended`);
      const body = await res.json();
      if (!mountedRef.current) return;
      if (body.success) {
        setRecommended(body.data?.recommended ?? []);
      } else {
        setError(body.error ?? t("packages.recommendedFetchFailed", undefined, "Failed to fetch recommended extensions"));
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err.message ?? t("common.networkError", undefined, "Network error"));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchRecommended();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchRecommended]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "package_operation_complete" && msg.success) {
        fetchRecommended();
      }
    };
    window.addEventListener("pi-package-event", handler);
    return () => window.removeEventListener("pi-package-event", handler);
  }, [fetchRecommended]);

  return { recommended, isLoading, error, refresh: fetchRecommended };
}
