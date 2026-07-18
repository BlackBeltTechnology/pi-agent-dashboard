/**
 * Connected split view — the glue between `App`'s content router and the pure
 * `SplitWorkspace` layout. Reads split state from `SplitWorkspaceContext` and
 * renders the chat slot (passed in) beside the co-mounted `EditorPane`.
 *
 * `SplitRouteSync` bridges the retained `/session/:id/editor` deep-link into
 * the split: on mount / param change it calls `openInSplit`, so a copied URL
 * opens the split and scrolls, instead of a full route swap.
 *
 * See change: split-editor-workspace.
 */

import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { useEffect } from "react";
import { useCanvasTier } from "../../hooks/useCanvasTier.js";
import { EditorPane } from "../editor-pane/EditorPane.js";
import { SplitWorkspace } from "./SplitWorkspace.js";
import { useSplitWorkspace } from "./SplitWorkspaceContext.js";

export function SessionSplitView({ chat }: { chat: React.ReactNode }) {
  const { split, updateSplit } = useSplitWorkspace();
  // Tablet tier (768–1023w, ≥600h) replaces chat when the split is open:
  // full-width canvas, no side-by-side, no chip (auto-canvas Decision 1 / S24).
  const tier = useCanvasTier();
  return (
    <SplitWorkspace
      mode={split.mode}
      ratio={split.ratio}
      orientation={split.orientation}
      onRatioChange={(ratio) => updateSplit({ ratio })}
      onModeChange={(mode) => updateSplit({ mode })}
      chat={chat}
      editor={<EditorPane />}
      replaceChat={tier === "tablet" && split.mode !== "closed"}
    />
  );
}

interface SplitRouteSyncProps {
  /** True while the `/session/:id/editor` route is active. */
  active: boolean;
  file?: string | null;
  line?: number | null;
  /**
   * `?url=` target for a `/view <url>`. Opened via `openUrlTarget` (or
   * `openLiveTarget` for a loopback URL, mirroring `CanvasDriver`). `file` wins
   * over `url` when both are present (D6). See change:
   * open-view-command-in-editor-pane (D1/D6).
   */
  url?: string | null;
}

/**
 * Opens the split from the deep-link route. Rendered under the provider so it
 * can reach the openers. No-op when the route is inactive or carries no target.
 */
export function SplitRouteSync({ active, file, line, url }: SplitRouteSyncProps) {
  const { openInSplit, ensureRevealed, openUrlTarget, openLiveTarget } = useSplitWorkspace();
  useEffect(() => {
    if (!active) return;
    // A param-less `/session/:id/editor` deep-link is a 6th mode-changer outside
    // the openers; route it through the same reveal guard so a deep-link opened
    // from `full` does not yank to `split`. See change: non-disruptive-file-open.
    if (file) {
      // `file` is authoritative when both params are present (D6).
      openInSplit(file, line ?? undefined);
    } else if (url) {
      // Loopback URLs land in the SSRF-gated LiveServerViewer, everything else
      // in UrlViewer — the same split CanvasDriver applies.
      if (isLoopbackUrl(url)) openLiveTarget(url);
      else openUrlTarget(url);
    } else {
      ensureRevealed();
    }
  }, [active, file, line, url, openInSplit, openUrlTarget, openLiveTarget, ensureRevealed]);
  return null;
}
