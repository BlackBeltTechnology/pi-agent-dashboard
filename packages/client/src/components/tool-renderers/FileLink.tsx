import type React from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { type ResolveMentionResult, resolveFileMention } from "../../lib/api/resolve-mention-api.js";
import { buildEditorUrl } from "../../lib/nav/route-builders.js";
import { resolveLinkOrigin } from "../../lib/util/link-origin.js";
import { normalizeUnderCwd } from "../../lib/util/normalize-path.js";
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
 * editor pane for the link's session; with no live split it deep-links to the
 * session editor route, and only with no `sessionId` falls back to the inline
 * read-only preview overlay (via the shared {@link useFileOpenRouting} hook).
 *
 * Resolution is LAZY: the link renders synchronously; on click the client asks
 * the server to resolve the mention against the real filesystem
 * ({@link resolveFileMention}) and opens the server-resolved path.
 *
 * Worktree sessions (D4): an absolute link rooted in the parent checkout is
 * first probed at its re-rooted worktree candidate ({@link resolveLinkOrigin});
 * a non-null probe is the open target, `null` falls back to the ORIGINAL path
 * (opened as the parent-checkout file), and a failed probe request takes the
 * offline fallback (never read as "copy absent"). Otherwise the server-resolved
 * path is opened as-is — no client re-root on top of it.
 *
 * Open target: `normalizeUnderCwd(resolved, cwd)` — a cwd-relative tab for an
 * in-cwd file, an absolute-path tab for anything else (incl. `outside: true`,
 * which was never statted: the pane's read gate shows the grant prompt / load
 * error, so such a link is NOT marked not-found).
 *
 * Outcomes:
 *  - resolved (or `outside`) → open the pane / deep link / overlay as above.
 *  - null      → inline not-found affordance (strikethrough/disabled), NO open (G1).
 *  - request FAILS (network/5xx) → fall back to today's client-side open (D5) —
 *    a failure is NOT treated as absent.
 *
 * {@link resolveLinkOrigin} also feeds the render-time tooltip and the D5
 * fallback open target.
 *
 * See change: unify-file-link-openability, fix-worktree-link-origin,
 * server-side-file-mention-resolution, fix-file-link-editor-routing.
 */
/**
 * D4: resolve `path`, probing the re-rooted worktree `candidate` first when it differs. A non-null, contained
 * probe wins; `null` falls through to the original path. A rejected request propagates (offline fallback).
 */
async function resolveWithWorktreeProbe(cwd: string, path: string, candidate: string): Promise<ResolveMentionResult> {
  if (candidate !== path) {
    const probe = await resolveFileMention(cwd, candidate);
    if (probe.resolved !== null && !probe.outside) return probe;
  }
  return resolveFileMention(cwd, path);
}

export function FileLink({ path, line, col, absolute, context, children }: Props) {
  const { cwd, openFile, hostManaged, previewTarget, closePreview } =
    useFileOpenRouting(context);
  const [notFound, setNotFound] = useState(false);
  const [, navigate] = useLocation();

  // Render-time client re-rooting: tooltip target + the D5 offline-fallback
  // open target ONLY. The authoritative open target is the server-resolved
  // path (see handleClick); this is never layered on top of it (D4).
  const origin = resolveLinkOrigin(cwd, path, absolute);
  const openTarget = absolute ? origin : path;

  // The editor pane is live for this session (relative AND absolute links open in it).
  const ws = useOptionalSplitWorkspace();
  const sessionId = context.sessionId;
  const splitLive = !!ws && !!sessionId && ws.sessionId === sessionId;

  // D5 offline fallback: today's client-side open (cwd-relative split tab or preview).
  const openViaFallback = () => {
    if (splitLive && ws && !absolute) {
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
      const result = await resolveWithWorktreeProbe(cwd, path, absolute ? origin : path);
      if (result.resolved === null) {
        setNotFound(true); // G1: inline not-found, make NO open call
        return;
      }
      // cwd-relative tab for an in-cwd file; absolute tab otherwise (incl. `outside`).
      const target = normalizeUnderCwd(result.resolved, cwd);
      if (splitLive && ws) {
        ws.openInSplit(target, line);
      } else if (sessionId) {
        navigate(buildEditorUrl(sessionId, target, line)); // no live split: deep-link the pane route
      } else {
        void openFile(result.resolved, line); // no session context: preview overlay
      }
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
      // `--link` is mode-aware; the raw `blue-400` it replaces failed the 3:1
      // floor on `--bg-code` in every light theme.
      // See change: repair-tool-error-surfaces (test-plan #F8).
      className={`bg-transparent border-0 p-0 m-0 font-inherit ${notFound ? "text-[var(--link)]/60 line-through cursor-not-allowed" : "text-[var(--link)] hover:underline cursor-pointer"}`}
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
