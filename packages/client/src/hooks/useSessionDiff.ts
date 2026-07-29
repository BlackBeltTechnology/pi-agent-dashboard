/**
 * Hook to fetch session file diff data from the server.
 */

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

export interface UseSessionDiffResult {
  data: SessionDiffResponse | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSessionDiff(sessionId: string | undefined): UseSessionDiffResult {
  const [data, setData] = useState<SessionDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef(false);
  const mountedRef = useRef(true);
  sessionIdRef.current = sessionId;

  const fetchDiff = useCallback(() => {
    if (!sessionIdRef.current) return;

    // buildSessionDiff runs git work synchronously server-side. Starting a new
    // request for every live Edit/Write/Bash result can queue many 5–20s jobs
    // and starve /api/session-file. Keep one request in flight and collapse all
    // intermediate refreshes into one trailing run.
    if (inFlightRef.current) {
      queuedRef.current = true;
      return;
    }

    const run = async () => {
      if (mountedRef.current) {
        setIsLoading(true);
        setError(null);
      }
      try {
        do {
          queuedRef.current = false;
          const targetSessionId = sessionIdRef.current;
          if (!targetSessionId) break;

          try {
            const res = await fetch(`${getApiBase()}/api/session-diff?sessionId=${encodeURIComponent(targetSessionId)}`);
            const body = await res.json();
            // A session switch may happen while the old request is running.
            if (!mountedRef.current || sessionIdRef.current !== targetSessionId) continue;
            if (body.success) {
              setData(body.data as SessionDiffResponse);
              setError(null);
            } else {
              setError(body.error ?? t("common.unknownError", undefined, "Unknown error"));
            }
          } catch (err: any) {
            if (mountedRef.current && sessionIdRef.current === targetSessionId) {
              setError(err.message ?? t("diff.fetchFailed", undefined, "Failed to fetch diff data"));
            }
          }
        } while (queuedRef.current && mountedRef.current);
      } finally {
        inFlightRef.current = null;
        if (mountedRef.current) setIsLoading(false);
      }
    };

    inFlightRef.current = run();
  }, []);

  useEffect(() => {
    // React StrictMode runs setup → cleanup → setup in development.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch on mount and when sessionId changes
  useEffect(() => {
    setData(null);
    setError(null);
    fetchDiff();
  }, [sessionId, fetchDiff]);

  return { data, isLoading, error, refresh: fetchDiff };
}
