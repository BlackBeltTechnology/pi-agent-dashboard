/**
 * Fetch a custom entry's FULL payload on demand. Backs the collapsed-first
 * renderer contract: the collapsed line is derived from the chat row alone, so
 * this issues no request until the user expands a row that carries an entryId.
 *
 * Mirrors `useToolFullResult`: skips the request when either id is missing,
 * maps a 404 to an "entry evicted" state (the entry was evicted, never flushed,
 * or lies outside the active branch), and never throws — a failed fetch
 * degrades the caller to the row's stored body.
 *
 * See change: add-custom-entry-renderer-slot (design D3/D5).
 */
import { useCallback, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

export interface CustomEntryPayload {
  /** The untruncated structured payload; `undefined` while collapsed/loading/failed. */
  payload?: unknown;
  /** Human-readable failure reason; `undefined` when none has been attempted/failed. */
  error?: string;
  loading: boolean;
  /** Issue the request. No-op when either id is absent. */
  fetchPayload: () => Promise<void>;
}

export function useCustomEntryPayload(
  sessionId: string | undefined,
  entryId: string | undefined,
): CustomEntryPayload {
  const [payload, setPayload] = useState<unknown>(undefined);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const fetchPayload = useCallback(async () => {
    if (!sessionId || !entryId) return;
    setLoading(true);
    setError(undefined);
    setPayload(undefined); // clear a stale payload before re-fetching
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${sessionId}/entry/${entryId}`);
      if (res.status === 404) {
        setError(t("tool.resultEvicted", undefined, "entry evicted"));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || t("tool.loadFullOutputFailed", undefined, "failed to load entry payload"));
        return;
      }
      const body = await res.json();
      setPayload(body?.data?.payload);
    } catch {
      // Network rejection (X10): the caller degrades to the stored body.
      setError(t("tool.loadFullOutputFailed", undefined, "failed to load entry payload"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, entryId]);

  return { payload, error, loading, fetchPayload };
}
