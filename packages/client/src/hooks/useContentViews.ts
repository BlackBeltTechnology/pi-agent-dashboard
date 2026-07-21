/**
 * Content view action helpers — navigate to URL-driven overlay routes.
 *
 * After overlay-url-routing: this hook no longer owns `useState` for
 * piResourcesState / piResourceFilePreview. The URL is
 * the single source of truth; the overlay components fetch their own
 * data on mount from the URL params.
 *
 * The hook reduces to three navigation helpers. Per-route data fetching
 * lives inside the overlay components themselves (`MarkdownPreviewView`
 * wrappers in App.tsx) or in dedicated hooks added in a later change.
 */
import { useCallback } from "react";
import {
  buildFolderSettingsUrl,
  buildPiResourceFileUrl,
} from "../lib/nav/route-builders.js";

export interface UseContentViewsOptions {
  /** wouter navigate — push the overlay URL onto history. */
  navigate: (to: string) => void;
}

export function useContentViews(options: UseContentViewsOptions) {
  const { navigate } = options;

  const handleOpenPiResources = useCallback((cwd: string) => {
    // Repointed to the Directory Settings page (defaults to the packages
    // page). See change: directory-settings-page-and-scoped-md-editing.
    navigate(buildFolderSettingsUrl(cwd));
  }, [navigate]);

  const handleViewPiResourceFile = useCallback((filePath: string, title: string) => {
    navigate(buildPiResourceFileUrl(filePath, title));
  }, [navigate]);

  return {
    handleOpenPiResources,
    handleViewPiResourceFile,
  };
}
