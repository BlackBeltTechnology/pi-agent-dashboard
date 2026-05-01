/**
 * `useDesktopBack` — hook wrapping the pure `selectDesktopBackTarget`
 * helper with live overlay setters and `navigate`. Returns a single
 * memoised `goBack()` callback for the desktop session-header back arrow.
 *
 * The hook is a thin dispatcher: it builds a `BackInputState` snapshot
 * from the current overlay flags, asks the helper which target to clear
 * (or whether to navigate), and calls the corresponding setter or
 * `navigate("/")`.
 *
 * See change: fix-desktop-back-navigation.
 */
import { useCallback } from "react";
import { selectDesktopBackTarget, type BackTargetKey } from "../lib/desktop-back.js";

export interface UseDesktopBackDeps {
  // Overlay setters (each accepts `null` to clear)
  setArchiveBrowserCwd: (v: null) => void;
  setSpecsBrowserCwd: (v: null) => void;
  setFlowYamlPreview: (v: null) => void;
  setDiffViewSessionId: (v: null) => void;
  setPiResourceFilePreview: (v: null) => void;
  setReadmePreview: (v: null) => void;
  setPiResourcesState: (v: null) => void;
  setPreviewState: (v: null) => void;
  // wouter's navigate function
  navigate: (to: string) => void;
  // Live overlay flags — boolean snapshot of the corresponding state
  archiveBrowserCwd: unknown;
  specsBrowserCwd: unknown;
  flowYamlPreview: unknown;
  diffViewSessionId: unknown;
  piResourceFilePreview: unknown;
  readmePreview: unknown;
  piResourcesState: unknown;
  previewState: unknown;
  selectedId?: string | null;
}

export function useDesktopBack(deps: UseDesktopBackDeps): () => void {
  // We deliberately depend on the truthy/falsy state of every overlay flag
  // rather than the values themselves so the callback stays referentially
  // stable as long as the flag truthiness doesn't change. (React's
  // useCallback uses === equality on deps; the boolean coercion gives us
  // that without forcing a coerce-on-every-render.)
  const goBack = useCallback(
    () => {
      const target = selectDesktopBackTarget({
        archiveBrowserCwd: !!deps.archiveBrowserCwd,
        specsBrowserCwd: !!deps.specsBrowserCwd,
        flowYamlPreview: !!deps.flowYamlPreview,
        diffViewSessionId: !!deps.diffViewSessionId,
        piResourceFilePreview: !!deps.piResourceFilePreview,
        readmePreview: !!deps.readmePreview,
        piResourcesState: !!deps.piResourcesState,
        previewState: !!deps.previewState,
        selectedId: !!deps.selectedId,
      });

      if (target.kind === "navigate") {
        deps.navigate(target.to);
        return;
      }

      // Dispatch to the right setter.
      const setterByTarget: Record<BackTargetKey, (v: null) => void> = {
        archive: deps.setArchiveBrowserCwd,
        specs: deps.setSpecsBrowserCwd,
        flowYaml: deps.setFlowYamlPreview,
        diff: deps.setDiffViewSessionId,
        piResourceFile: deps.setPiResourceFilePreview,
        readme: deps.setReadmePreview,
        piResources: deps.setPiResourcesState,
        preview: deps.setPreviewState,
      };
      setterByTarget[target.target](null);
    },
    // Re-create only when overlay truthiness or selectedId changes.
    // Setters and `navigate` are referentially stable per-render in
    // App.tsx's existing pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      !!deps.archiveBrowserCwd,
      !!deps.specsBrowserCwd,
      !!deps.flowYamlPreview,
      !!deps.diffViewSessionId,
      !!deps.piResourceFilePreview,
      !!deps.readmePreview,
      !!deps.piResourcesState,
      !!deps.previewState,
      deps.selectedId ?? null,
      deps.navigate,
      deps.setArchiveBrowserCwd,
      deps.setSpecsBrowserCwd,
      deps.setFlowYamlPreview,
      deps.setDiffViewSessionId,
      deps.setPiResourceFilePreview,
      deps.setReadmePreview,
      deps.setPiResourcesState,
      deps.setPreviewState,
    ],
  );

  return goBack;
}
