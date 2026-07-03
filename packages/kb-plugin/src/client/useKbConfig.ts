/**
 * `useKbConfig(cwd)` — GET the folder's KB config + `save(patch)` → PUT.
 *
 * Round-trips the full config object; the panel only edits path fields
 * (sources / include / exclude / dbPath) and the server preserves the rest.
 * See change: add-kb-folder-slot.
 */
import { useCallback, useEffect, useState } from "react";
import type { KbConfigPatch, KbConfigResponse } from "../shared/kb-plugin-types.js";
import { fetchKbConfig, saveKbConfig } from "./kb-api.js";

export interface UseKbConfigResult {
  data: KbConfigResponse | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  save: (patch: KbConfigPatch) => Promise<void>;
  refetch: () => void;
}

export function useKbConfig(cwd: string | null | undefined): UseKbConfigResult {
  const [data, setData] = useState<KbConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!cwd) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchKbConfig(cwd, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [cwd, nonce]);

  const save = useCallback(
    async (patch: KbConfigPatch): Promise<void> => {
      if (!cwd) return;
      setSaving(true);
      setError(null);
      try {
        const d = await saveKbConfig(cwd, patch);
        setData(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [cwd],
  );

  return { data, loading, error, saving, save, refetch };
}
