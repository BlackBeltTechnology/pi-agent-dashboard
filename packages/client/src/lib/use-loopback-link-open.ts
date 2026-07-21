/**
 * Shared click handler routing a loopback dev-server link into the internal
 * `live-server` split viewer instead of a system-browser tab.
 *
 * Used by BOTH anchor renderers (`MarkdownContent.a()` and tool-output
 * `UrlLink`). On a plain primary-button click of a loopback href, when a split
 * workspace is present, it `preventDefault`s and opens the target in the split.
 * Modifier/middle-click, non-loopback hrefs, and a `null` context (renderer
 * mounted outside the split workspace) all no-op so the native
 * `target="_blank"` anchor keeps its browser behaviour.
 *
 * The `isLoopbackUrl` check is a UX router, NOT a trust boundary — the server
 * `validateLiveTarget` remains the SSRF gate.
 *
 * See change: open-loopback-links-in-split-viewer.
 */
import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type React from "react";
import { useCallback } from "react";
import { useOptionalSplitWorkspace } from "../components/split/SplitWorkspaceContext.js";

export function useLoopbackLinkOpen(): (e: React.MouseEvent, href: string) => void {
  const ctx = useOptionalSplitWorkspace();
  return useCallback(
    (e: React.MouseEvent, href: string) => {
      if (!ctx) return;
      if (!isLoopbackUrl(href)) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      ctx.openLiveTarget(href);
    },
    [ctx],
  );
}
