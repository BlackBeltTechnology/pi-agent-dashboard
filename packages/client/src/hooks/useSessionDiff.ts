/**
 * Hook to fetch session file diff data from the server.
 */

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";
import { logRejection } from "../lib/report-error.js";

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

  const fetchDiff = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/session-diff?sessionId=${encodeURIComponent(sessionId)}`);
      const body = await res.json();
      if (body.success) {
        setData(body.data as SessionDiffResponse);
      } else {
        setError(body.error ?? t("common.unknownError", undefined, "Unknown error"));
      }
    } catch (err: any) {
      setError(err.message ?? t("diff.fetchFailed", undefined, "Failed to fetch diff data"));
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Fetch on mount and when sessionId changes
  useEffect(() => {
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchDiff().catch(logRejection("useSessionDiff.fetch"));
  }, [fetchDiff]);

  return { data, isLoading, error, refresh: fetchDiff };
}
