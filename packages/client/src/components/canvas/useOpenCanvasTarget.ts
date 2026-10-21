/**
 * The ONE opener for canvas targets (change: improve-canvas-html-and-url-ux, D8).
 * Extracted from `CanvasDriver` so the auto-open effect, the mobile file chip,
 * the server confirm chip and the `canvas` tool card share routing + provenance:
 *
 *   caller                 opener     background
 *   auto-open effect       agent      yes
 *   file chip / card       operator   no
 *   server/URL chip + card operator*  no   (*egress stays restricted: the tap
 *                                          consents to connecting only)
 *
 * `.html` files open as served static targets; loopback URLs are NEVER opened
 * by `open` (no auto-open, no fetch): they go through `openServer` on a human tap.
 */
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useState } from "react";
import { probeLoopbackServer } from "../../lib/canvas/probe-loopback.js";
import type { Opener } from "../../lib/live-preview/preview-policy.js";
import { useSplitWorkspace } from "../split/SplitWorkspaceContext.js";

export interface OpenCanvasOpts {
  opener: Opener;
  /** Add silently while the editor is shown (the auto-open effect). */
  background: boolean;
  /** Re-declare of an already-open target: reload (inactive) or flag (active). */
  bump?: boolean;
}

export type ServerOpenStatus = "idle" | "probing" | "not-running" | "not-responding";

const isHtmlPath = (cwd: string, path: string): boolean => {
  const abs = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? path : `${cwd}/${path}`;
  return fileKind(abs).viewer === "html";
};

export function useOpenCanvasTarget() {
  const { sessionId, openInSplit, openLiveTarget, openStaticTarget, openUrlTarget } = useSplitWorkspace();
  const [serverStatus, setServerStatus] = useState<ServerOpenStatus>("idle");

  const open = useCallback(
    (target: ViewTarget, { opener, background, bump }: OpenCanvasOpts): void => {
      if (target.kind === "file") {
        if (isHtmlPath(target.cwd, target.path)) {
          openStaticTarget(target.cwd, target.path, { opener, background, bump });
          return;
        }
        // Canvas open → restrictCsp for document viewers (auto-open egress ≤ manual
        // click, S34). `autoOpened` is provenance: only an agent opener sets it.
        openInSplit(target.path, undefined, true, { background, autoOpened: opener === "agent" });
      } else if (target.kind === "url" && !isLoopbackUrl(target.url)) {
        // Generic url/youtube declare → the `url` viewer renders it normally (S35).
        openUrlTarget(target.url, { background });
      }
      // Loopback URL: never opened here. A human tap uses `openServer`.
    },
    [openInSplit, openStaticTarget, openUrlTarget],
  );

  /**
   * Confirm-chip tap / active server-or-URL card click: probe `127.0.0.1:port`,
   * and on success open the restricted preset at the declared `path`.
   */
  const openServer = useCallback(
    async (port: number, path?: string): Promise<void> => {
      setServerStatus("probing");
      const outcome = await probeLoopbackServer(port, sessionId);
      if (outcome !== "iframe") {
        setServerStatus(outcome);
        return;
      }
      setServerStatus("idle");
      const suffix = path && path !== "/" ? (path.startsWith("/") ? path : `/${path}`) : "/";
      openLiveTarget(`http://127.0.0.1:${port}${suffix}`, { opener: "agent" });
    },
    [openLiveTarget, sessionId],
  );

  return { open, openServer, serverStatus };
}
