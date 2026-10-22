/**
 * Hook to fetch session file diff data from the server.
 */

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";
import { logRejection } from "../lib/report-error.js";

export interface UseSessionDiffResult {
  data: SessionDiffResponse | null;
  isLoading: boolean;
  error: string | null;
  /** Fetch now. The promise settles when the request does (it never rejects). */
  refresh: () => Promise<void>;
}

export interface UseSessionDiffOptions {
  /**
   * Fetch on mount and on `sessionId` change (default `true`). `false` leaves
   * every fetch to the caller's `refresh` (the dock's coalescing scheduler,
   * `useDockDiff`). See change: add-composer-dock (D5).
   */
  auto?: boolean;
}

type DiffOutcome = { data: SessionDiffResponse } | { error: string };

async function requestSessionDiff(sessionId: string): Promise<DiffOutcome> {
  try {
    const res = await fetch(`${getApiBase()}/api/session-diff?sessionId=${encodeURIComponent(sessionId)}`);
    const body = await res.json();
    if (body.success) return { data: body.data as SessionDiffResponse };
    return { error: body.error ?? t("common.unknownError", undefined, "Unknown error") };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : undefined) ?? t("diff.fetchFailed", undefined, "Failed to fetch diff data") };
  }
}

export function useSessionDiff(sessionId: string | undefined, options?: UseSessionDiffOptions): UseSessionDiffResult {
  const auto = options?.auto ?? true;
  const [data, setData] = useState<SessionDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A response for a session the hook has since moved off must not land.
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;

  const fetchDiff = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    const outcome = await requestSessionDiff(sessionId);
    if (currentSession.current !== sessionId) return;
    if ("data" in outcome) setData(outcome.data);
    else setError(outcome.error);
    setIsLoading(false);
  }, [sessionId]);

  // A different session starts from nothing: never show the previous one's files.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the session only
  useEffect(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, [sessionId]);

  // Fetch on mount and when sessionId changes
  useEffect(() => {
    if (!auto) return;
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchDiff().catch(logRejection("useSessionDiff.fetch"));
  }, [auto, fetchDiff]);

  return { data, isLoading, error, refresh: fetchDiff };
}
