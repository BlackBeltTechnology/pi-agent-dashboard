/**
 * Fetch the full stored result for a tool call on demand. Backs the
 * "Show full output" affordance when the rendered result was truncated.
 *
 * See change: adopt-pi-071-072-073-features (C.1).
 */
import { useCallback, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

interface ToolFullResult {
  result?: string;
  error?: string;
  loading: boolean;
  /** Fetch the full result. Returns the result text on success. */
  fetchFull: () => Promise<void>;
}

export function useToolFullResult(sessionId: string | undefined, toolCallId: string | undefined): ToolFullResult {
  const [result, setResult] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const fetchFull = useCallback(async () => {
    if (!sessionId || !toolCallId) return;
    setLoading(true);
    setError(undefined);
    setResult(undefined); // clear stale full output before re-fetching
    try {
      const res = await fetch(`${getApiBase()}/api/sessions/${sessionId}/tool-result/${toolCallId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.error ||
            (res.status === 404
              ? t("tool.resultEvicted", undefined, "result evicted")
              : t("tool.loadFullOutputFailed", undefined, "failed to load full output")),
        );
        return;
      }
      const body = await res.json();
      setResult(typeof body.result === "string" ? body.result : String(body.result ?? ""));
    } catch {
      setError(t("tool.loadFullOutputFailed", undefined, "failed to load full output"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, toolCallId]);

  return { result, error, loading, fetchFull };
}
