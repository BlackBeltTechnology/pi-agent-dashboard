/**
 * Session-independent model catalogue (`GET /api/models`) as a hook, shared by
 * Settings and the sessionless composers (folder home, ended sessions).
 *
 * Semantics kept from the original `SettingsPanel` state:
 *  - `catalogue === null` is the cold "loading" state;
 *  - `models` is the last models a request actually returned, so a refetch that
 *    fails never BLANKS a catalogue that already loaded;
 *  - last-response-wins.
 *
 * `seedFromCache` (opt-in) starts from the module-wide last good result so a
 * second consumer renders instantly; it always refetches on mount regardless.
 * `enabled: false` stays idle (no request).
 *
 * See changes: settings-default-model-without-session, redesign-directory-home-split.
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchModelCatalogue, type ModelCatalogueResult } from "../lib/api/models-api.js";

let lastGood: ModelInfo[] | null = null;

/** Test seam: forget the module-wide last good catalogue. */
export function resetModelCatalogueCache(): void {
  lastGood = null;
}

export interface ModelCatalogueState {
  catalogue: ModelCatalogueResult | null;
  /** Catalogue models, falling back to the last good list on a failed refetch. */
  models: ModelInfo[];
  /** True while a request is in flight. */
  fetching: boolean;
  /** Cold-load only: no response has landed yet. */
  loading: boolean;
  unavailable: boolean;
  refetch: () => Promise<void>;
}

export function useModelCatalogue(opts: { enabled?: boolean; seedFromCache?: boolean } = {}): ModelCatalogueState {
  const { enabled = true, seedFromCache = false } = opts;
  const [catalogue, setCatalogue] = useState<ModelCatalogueResult | null>(null);
  const [lastGoodModels, setLastGoodModels] = useState<ModelInfo[] | null>(seedFromCache ? lastGood : null);
  const [fetching, setFetching] = useState(enabled);

  const refetch = useCallback(() => {
    setFetching(true);
    return fetchModelCatalogue()
      .then((result) => {
        setCatalogue(result);
        if (result.status === "ok") {
          lastGood = result.models;
          setLastGoodModels(result.models);
        }
      })
      .finally(() => setFetching(false));
  }, []);

  useEffect(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  const models = useMemo(
    () => (catalogue?.status === "ok" ? catalogue.models : (lastGoodModels ?? [])),
    [catalogue, lastGoodModels],
  );

  return {
    catalogue,
    models,
    fetching,
    loading: fetching && catalogue === null,
    unavailable: catalogue?.status === "unavailable",
    refetch,
  };
}
