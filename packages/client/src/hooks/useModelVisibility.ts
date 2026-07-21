import { useCallback, useEffect, useState } from "react";
import {
  STORAGE_KEY,
  loadVisibility,
  saveVisibility,
  type PersistedModelVisibility,
} from "../lib/model-visibility.js";

/**
 * React hook exposing the persisted `pi-dashboard.modelVisibility` state.
 *
 * - Mount: reads from localStorage via `loadVisibility()`.
 * - `update(patch)`: merges patch into current state, persists, re-renders.
 * - Cross-tab sync: subscribes to the `storage` event and re-loads when
 *   another tab modifies {@link STORAGE_KEY}.
 *
 * The transient `showHiddenInSelector` toggle is NOT managed by this hook —
 * it lives in component-local state on the `ModelSelector`'s wrapper.
 *
 * See change: hide-models-from-selector.
 */
export function useModelVisibility(): {
  vis: PersistedModelVisibility;
  update: (patch: Partial<PersistedModelVisibility>) => void;
} {
  const [vis, setVis] = useState<PersistedModelVisibility>(() => loadVisibility());

  const update = useCallback((patch: Partial<PersistedModelVisibility>) => {
    setVis((prev) => {
      const next: PersistedModelVisibility = {
        hiddenProviders: patch.hiddenProviders ?? prev.hiddenProviders,
        hiddenModels: patch.hiddenModels ?? prev.hiddenModels,
      };
      saveVisibility(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      // Another tab wrote a new value; reload from storage.
      setVis(loadVisibility());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return { vis, update };
}
