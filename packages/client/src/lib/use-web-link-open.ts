/**
 * Shared click handler routing a web link into the editor pane instead of a system-browser tab.
 *
 * Used by BOTH anchor renderers (`MarkdownContent.a()` and tool-output `UrlLink`). On a plain primary-button
 * click, when a split workspace is present:
 *  - a loopback href → `openLiveTarget` (the internal `live-server` viewer), in any context, as before;
 *  - any other http(s) href → `openUrlTarget(url, {opener: "operator-click"})`, but ONLY when the link's own
 *    session (`context.sessionId`) is the split workspace's session — the session's own pane transcript, never
 *    another session or surface (rich-chat-links design D1/D7).
 * Modifier/middle-click, every other scheme, a mismatched/absent session and a `null` workspace all no-op so the
 * native `target="_blank"` anchor keeps its browser behaviour.
 *
 * The `isLoopbackUrl` check is a UX router, NOT a trust boundary — the server `validateLiveTarget` remains the
 * SSRF gate, and the web-page renderer gates its probe on the `operator-click` opener.
 *
 * See changes: open-loopback-links-in-split-viewer, rich-chat-links.
 */
import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type React from "react";
import { useCallback } from "react";
import { useOptionalSplitWorkspace } from "../components/split/SplitWorkspaceContext.js";
import type { ToolContext } from "../components/tool-renderers/types.js";

const HTTP_URL = /^https?:\/\//i;

export function useWebLinkOpen(context?: Pick<ToolContext, "sessionId">): (e: React.MouseEvent, href: string) => void {
  const ctx = useOptionalSplitWorkspace();
  const linkSessionId = context?.sessionId;
  return useCallback(
    (e: React.MouseEvent, href: string) => {
      if (!ctx) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isLoopbackUrl(href)) {
        e.preventDefault();
        ctx.openLiveTarget(href);
        return;
      }
      if (!HTTP_URL.test(href) || !linkSessionId || linkSessionId !== ctx.sessionId) return;
      e.preventDefault();
      ctx.openUrlTarget(href, { opener: "operator-click" });
    },
    [ctx, linkSessionId],
  );
}
