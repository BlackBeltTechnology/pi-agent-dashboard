import type React from "react";
import { useState } from "react";
import { resolveLinkOrigin } from "../../lib/util/link-origin.js";
import { resolveFileMention } from "../../lib/api/resolve-mention-api.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import type { ToolContext } from "./types.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";

interface Props {
  path: string;
  line?: number;
  col?: number;
  /** Token marked absolute (POSIX `/`, decoded `file://`, Windows drive). */
  absolute?: boolean;
  context: ToolContext;
  children: React.ReactNode;
}

/**
 * Clickable file reference rendered inside tool output and prose. Opens the
 * internal editor split when live for this session; otherwise routes the click
 * to an inline read-only preview overlay via the shared
 * {@link useFileOpenRouting} hook.
 *
 * Resolution is LAZY: the link renders synchronously; on click the client asks
 * the server to resolve the mention against the real filesystem
 * ({@link resolveFileMention}) and opens the server-resolved absolute path
 * across ALL open paths — preview overlay AND the split-workspace pane (G2).
 * The server owns re-rooting, so a server-resolved path is opened DIRECTLY
 * (no client-side {@link resolveLinkOrigin} on top — no double re-root, D4).
 *
 * Outcomes:
 *  - resolved  → open the resolved path.
 *  - null      → inline not-found affordance (strikethrough/disabled), NO open (G1).
 *  - request FAILS (network/5xx) → fall back to today's client-side open (D5) —
 *    a failure is NOT treated as absent.
 *
 * {@link resolveLinkOrigin} survives only for the render-time tooltip and the
 * D5 fallback open target.
 *
 * See change: unify-file-link-openability, fix-worktree-link-origin,
 * server-side-file-mention-resolution.
 */
export function FileLink({ path, line, col, absolute, context, children }: Props) {
  const { cwd, openFile, hostManaged, previewTarget, closePreview } =
    useFileOpenRouting(context);
  const [notFound, setNotFound] = useState(false);

  // Render-time client re-rooting: tooltip target + the D5 offline-fallback
  // open target ONLY. The authoritative open target is the server-resolved
  // path (see handleClick); this is never layered on top of it (D4).
  const origin = resolveLinkOrigin(cwd, path, absolute);
  const openTarget = absolute ? origin : path;

  // Prefer the in-dashboard editor split when it is available for this session
  // and the token is a cwd-relative path (the pane is rooted at cwd). Falls
  // back to the preview overlay everywhere else.
  const ws = useOptionalSplitWorkspace();
  const canSplitOpen = !!ws && !absolute && !!context.sessionId && ws.sessionId === context.sessionId;

  // D5 offline fallback: today's client-side open (split pane or preview).
  const openViaFallback = () => {
    if (canSplitOpen && ws) {
      ws.openInSplit(path, line);
      return;
    }
    void openFile(openTarget, line);
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (notFound) return; // already resolved to absent
    // No cwd → nothing to resolve against; keep the legacy client-side open.
    if (!cwd) {
      openViaFallback();
      return;
    }
    try {
      // Send the token's processed `path` (normalized: `file://` + diff prefix
      // already stripped), not the verbatim label text (D1).
      const result = await resolveFileMention(cwd, path);
      if (result.resolved === null) {
        setNotFound(true); // G1: inline not-found, make NO open call
        return;
      }
      if (canSplitOpen && ws) {
        // Relative token, existence-gated by the resolve round-trip (G2). The
        // pane is cwd-rooted, so open the cwd-relative path (tab-key parity
        // with tree clicks); the resolved abs path is the same file.
        ws.openInSplit(path, line);
        return;
      }
      // Server-resolved absolute path opened DIRECTLY — no resolveLinkOrigin (D4).
      void openFile(result.resolved, line);
    } catch {
      // D5: a transport failure (NOT a null result) → client-side fallback.
      openViaFallback();
    }
  };

  const resolved = origin;
  const titleSuffix = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const title = notFound ? `Not found: ${resolved}${titleSuffix}` : `Preview ${resolved}${titleSuffix}`;

  return (
    <>
    <button
      type="button"
      onClick={handleClick}
      title={title}
      aria-disabled={notFound}
      data-not-found={notFound ? "true" : undefined}
      // Not draggable + user-select:text so a click-drag that starts on or
      // crosses the link extends the text selection (a <button> otherwise
      // swallows the drag and excludes its label from the selection). A
      // plain click still opens; native click-vs-drag suppression handles it.
      draggable={false}
      // Inline-only styling, no padding/margin so native text selection
      // across the link boundary is preserved (D8). Once resolved-absent the
      // link is struck through + dimmed and no longer opens (G1).
      className={`bg-transparent border-0 p-0 m-0 font-inherit ${notFound ? "text-blue-400/60 line-through cursor-not-allowed" : "text-blue-400 hover:underline cursor-pointer"}`}
      style={{ font: "inherit", userSelect: "text" }}
    >
      {children}
    </button>
    {!hostManaged && previewTarget && (
      <FilePreviewOverlay
        cwd={previewTarget.cwd}
        path={previewTarget.path}
        line={previewTarget.line}
        onClose={closePreview}
      />
    )}
    </>
  );
}
