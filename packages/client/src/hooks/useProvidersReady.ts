import { useState, useEffect, useCallback } from "react";
import { getApiBase } from "../lib/api/api-context.js";

export interface ProvidersReadyState {
  /** True when loading has finished at least once. */
  loading: boolean;
  /** True when at least one provider has a non-empty apiKey. */
  ready: boolean;
  /** Number of providers with a non-empty apiKey. */
  count: number;
}

/**
 * Observes `/api/providers` to determine whether at least one LLM provider has
 * a non-empty apiKey configured. Refetches on window focus and on the
 * `provider-auth-event` custom event (dispatched after OAuth / key entry).
 */
export function useProvidersReady(): ProvidersReadyState {
  const [state, setState] = useState<ProvidersReadyState>({
    loading: true,
    ready: false,
    count: 0,
  });

  const refetch = useCallback(() => {
    const base = getApiBase();
    // Providers come from TWO sources:
    //   1. `/api/providers` — OpenAI-style baseUrl+apiKey entries in dashboard config
    //   2. `/api/provider-auth/status` — pi OAuth / API-key credentials (~/.pi/agent/auth.json)
    // A user is "ready" if ANY source has at least one authenticated/keyed entry.
    const providersP = fetch(`${base}/api/providers`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    const authStatusP = fetch(`${base}/api/provider-auth/status`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    Promise.all([providersP, authStatusP])
      .then(([providersData, authStatusData]) => {
        let count = 0;
        if (providersData?.success && providersData.providers) {
          const entries = Object.values(
            providersData.providers as Record<string, { apiKey?: string }>,
          );
          count += entries.filter(
            (p) => typeof p.apiKey === "string" && p.apiKey.trim().length > 0,
          ).length;
        }
        if (Array.isArray(authStatusData)) {
          count += (authStatusData as Array<{ authenticated?: boolean }>).filter(
            (s) => s?.authenticated === true,
          ).length;
        }
        setState({ loading: false, ready: count > 0, count });
      })
      .catch(() => {
        setState({ loading: false, ready: false, count: 0 });
      });
  }, []);

  useEffect(() => {
    refetch();
    const onFocus = () => refetch();
    const onAuthEvent = () => refetch();
    window.addEventListener("focus", onFocus);
    window.addEventListener("provider-auth-event", onAuthEvent as EventListener);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("provider-auth-event", onAuthEvent as EventListener);
    };
  }, [refetch]);

  return state;
}
