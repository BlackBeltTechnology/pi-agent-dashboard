import type React from "react";
import { resolveLinkOrigin } from "../../lib/link-origin.js";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import { useOptionalSplitWorkspace } from "../SplitWorkspaceContext.js";
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
 * Path resolution goes through {@link resolveLinkOrigin}: relative tokens join
 * against `cwd`; absolute tokens (POSIX `/`, decoded `file://`, Windows drive)
 * pass through verbatim EXCEPT in a worktree session, where an absolute path
 * rooted in the parent checkout is re-rooted onto the worktree's own tree
 * (spec: tool-output-linkification — "Worktree link-origin re-rooting").
 *
 * See change: unify-file-link-openability, fix-worktree-link-origin.
 */
export function FileLink({ path, line, col, absolute, context, children }: Props) {
  const { cwd, openFile, hostManaged, previewTarget, closePreview } =
    useFileOpenRouting(context);

  // Re-root an absolute parent-checkout path onto the worktree (worktree
  // sessions only); relative tokens stay raw so the server resolves them
  // against cwd as before. `origin` drives the open/preview target AND the
  // tooltip so the link points at the worktree's own copy.
  const origin = resolveLinkOrigin(cwd, path, absolute);
  const openTarget = absolute ? origin : path;

  // Prefer the in-dashboard editor split when it is available for this session
  // and the token is a cwd-relative path (the pane is rooted at cwd). Falls
  // back to the preview overlay everywhere else.
  const ws = useOptionalSplitWorkspace();
  const canSplitOpen = !!ws && !absolute && !!context.sessionId && ws.sessionId === context.sessionId;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canSplitOpen && ws) {
      ws.openInSplit(path, line);
      return;
    }
    void openFile(openTarget, line);
  };

  const resolved = origin;
  const titleSuffix = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const title = `Preview ${resolved}${titleSuffix}`;

  return (
    <>
    <button
      type="button"
      onClick={handleClick}
      title={title}
      // Not draggable + user-select:text so a click-drag that starts on or
      // crosses the link extends the text selection (a <button> otherwise
      // swallows the drag and excludes its label from the selection). A
      // plain click still opens; native click-vs-drag suppression handles it.
      draggable={false}
      // Inline-only styling, no padding/margin so native text selection
      // across the link boundary is preserved (D8).
      className="text-blue-400 hover:underline bg-transparent border-0 p-0 m-0 font-inherit cursor-pointer"
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
