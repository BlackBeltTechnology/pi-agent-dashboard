/**
 * React bindings for the file-handler store: context (so tests inject a fresh
 * store; default = the page-level singleton), subscription hook and the
 * reactive enabled-claims list.
 *
 * See change: add-editor-pane-file-handlers (D5).
 */
import { useSlotClaimsVersion, useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { type FileHandlerClaim, listFileHandlerClaims } from "./file-handler-claims.js";
import { type FileHandlerStore, type FileHandlerStoreState, fileHandlerStore } from "./file-handler-store.js";

const FileHandlerStoreContext = createContext<FileHandlerStore>(fileHandlerStore);

export const FileHandlerStoreProvider = FileHandlerStoreContext.Provider;

export function useFileHandlerStore(): FileHandlerStore {
  return useContext(FileHandlerStoreContext);
}

/** Subscribe to the store's immutable state snapshot. */
export function useFileHandlerState(): FileHandlerStoreState {
  const store = useFileHandlerStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Enabled `editor-pane-file-handler` claims in contract order; re-evaluates on a slot-claims bump. */
export function useFileHandlerClaims(): FileHandlerClaim[] {
  const version = useSlotClaimsVersion();
  const registry = useSlotRegistryOrNull();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the registry's change signal
  return useMemo(() => listFileHandlerClaims(registry), [registry, version]);
}
