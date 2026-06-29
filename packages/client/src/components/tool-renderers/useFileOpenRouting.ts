import { useCallback, useContext, useState } from "react";
import { isLocalhost, openEditor } from "../../lib/editor-api.js";
import { FilePreviewContext, type FilePreviewTarget } from "../FilePreviewContext.js";
import type { ToolContext } from "./types.js";

export interface FileOpenRouting {
  /** Session cwd from context (preview overlay needs it). */
  cwd?: string;
  /** True when the dashboard is on localhost AND ≥1 editor is detected. */
  localEditorAvailable: boolean;
  /** Name of the first detected editor, when available. */
  editorName?: string;
  /**
   * Route a click: localhost + editor → `POST /api/open-editor`;
   * otherwise → open the in-dashboard preview overlay. No-op without `cwd`.
   */
  openFile: (path: string, line?: number) => Promise<void> | void;
  /**
   * True when a `FilePreviewProvider` is mounted above (e.g. inside
   * `ChatView`): the single hoisted `FilePreviewHost` renders the overlay, so
   * the consumer renders nothing. False on standalone surfaces (README dialog,
   * markdown preview view) where the consumer renders its own fallback overlay.
   */
  hostManaged: boolean;
  /** Leaf-local preview target for the fallback (no-provider) path, else null. */
  previewTarget: FilePreviewTarget | null;
  /** Close the fallback (leaf-local) preview overlay. */
  closePreview: () => void;
}

/**
 * Single source of truth for the open-vs-preview routing shared by
 * `FileLink` and `OpenFileButton` (D5). Keeps the routing decision in one
 * place so both surfaces behave identically.
 *
 * Preview state ownership is dual-mode:
 *   - Inside a `FilePreviewProvider` (chat message list) the open-state lives
 *     ABOVE the churning subtree, so the overlay survives streaming tokens,
 *     react-markdown reparses, and new messages. `hostManaged` is true and the
 *     single `FilePreviewHost` renders the overlay.
 *   - Outside a provider (README dialog, markdown preview, plugin primitives)
 *     it falls back to leaf-local `useState`, preserving the prior behavior so
 *     those surfaces never crash or dead-end.
 *
 * See change: unify-file-link-openability (spec: open-in-editor).
 * See change: fix-file-preview-survives-message-churn (state hoist + fallback).
 */
export function useFileOpenRouting(context: ToolContext): FileOpenRouting {
  const { cwd, editors } = context;
  const provider = useContext(FilePreviewContext);
  const [localTarget, setLocalTarget] = useState<FilePreviewTarget | null>(null);
  const hostManaged = provider != null;
  const open = provider ? provider.open : setLocalTarget;
  const localEditorAvailable = isLocalhost() && editors.length > 0;

  const openFile = useCallback(
    async (path: string, line?: number) => {
      if (!cwd) return; // no cwd → nothing actionable
      if (localEditorAvailable) {
        // On failure (editor spawn rejected, containment 403, …) fall back to
        // the preview overlay so a click never dead-ends or leaks an
        // unhandled rejection.
        try {
          await openEditor(cwd, editors[0].id, path, line);
        } catch {
          open({ cwd, path, line });
        }
      } else {
        open({ cwd, path, line });
      }
    },
    [cwd, editors, localEditorAvailable, open],
  );

  return {
    cwd,
    localEditorAvailable,
    editorName: editors[0]?.name,
    openFile,
    hostManaged,
    previewTarget: hostManaged ? null : localTarget,
    closePreview: () => setLocalTarget(null),
  };
}
