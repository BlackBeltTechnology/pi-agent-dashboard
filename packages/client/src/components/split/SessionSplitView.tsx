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
import { useEffect, useRef } from "react";
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
  /**
   * Per-open intent read from the history entry's state (`useHistoryState` →
   * `openNonce`). A FRESH nonce re-applies an otherwise-identical target, so a
   * target the user closed — with the pane's close control or by closing only
   * its file tab, both of which leave the URL naming the target — can be
   * re-opened by the same control. Re-renders at the SAME nonce stay no-ops.
   * See change: consolidate-flow-agent-cards (D8).
   */
  nonce?: string;
  /**
   * `?tab=<virtual-path>` values (repeatable), applied in order through
   * `openPluginTab`; unclaimed or built-in prefixes are ignored. The last
   * applied tab ends up active. See change: add-browser-editor-pane-tab (D3).
   */
  tabs?: readonly string[];
}

/**
 * Opens the split from the deep-link route. Rendered under the provider so it
 * can reach the openers. No-op when the route is inactive or carries no target.
 */
export function SplitRouteSync({ active, file, line, url, nonce, tabs }: SplitRouteSyncProps) {
  const { sessionId, openInSplit, ensureRevealed, openUrlTarget, openLiveTarget, openPluginTab } = useSplitWorkspace();
  const tabsKey = tabs?.join("\u0001") ?? "";
  // Apply each route target ONCE per open INTENT. The nonce makes a deliberate
  // re-open of an unchanged URL a new intent (D8); without it, the openers'
  // identity change caused by closing the editor would re-open the split the
  // user just closed, while a genuine re-open of the same URL would be lost.
  // Keyed like CanvasDriver's `lastKeyRef`; reset when the route goes inactive
  // so back/forward re-applies. See change: attach-flow-before-run,
  // consolidate-flow-agent-cards (D8).
  const key = active
    ? `${sessionId}\u0000${file ?? ""}\u0000${line ?? ""}\u0000${url ?? ""}\u0000${nonce ?? ""}\u0000${tabsKey}`
    : null;
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (key == null) {
      lastKeyRef.current = null;
      return;
    }
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
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
    } else if (tabsKey) {
      // Plugin tabs: each claimed value in order (focus-or-add). Nothing
      // claimed → no reveal, no state change (spec: ignored without error).
      for (const p of tabsKey.split("\u0001")) openPluginTab(p);
    } else {
      ensureRevealed();
    }
    // `tabsKey` (not `tabs`) — the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, file, line, url, openInSplit, openUrlTarget, openLiveTarget, ensureRevealed, openPluginTab]);
  return null;
}
