import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

const DEBOUNCE_MS = 400;

export function usePackageSearch() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [packages, setPackages] = useState<NpmPackageResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const fetchPackages = useCallback(async (q: string, type: string | null) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);

      const res = await fetch(`${getApiBase()}/api/packages/search?${params}`, { signal: ctrl.signal });
      const body = await res.json();
      if (ctrl.signal.aborted) return;

      if (body.success) {
        setPackages(body.data.packages);
        setTotal(body.data.total);
      } else {
        setError(body.error ?? t("packages.searchFailed", undefined, "Search failed"));
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message ?? t("common.networkError", undefined, "Network error"));
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  // Debounced search on query/type change
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchPackages(query, typeFilter);
    }, query ? DEBOUNCE_MS : 0); // no debounce on initial/filter-only

    return () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [query, typeFilter, fetchPackages]);

  const refresh = useCallback(() => {
    fetchPackages(query, typeFilter);
  }, [query, typeFilter, fetchPackages]);

  return {
    query,
    setQuery,
    typeFilter,
    setTypeFilter,
    packages,
    total,
    isLoading,
    error,
    refresh,
  };
}
