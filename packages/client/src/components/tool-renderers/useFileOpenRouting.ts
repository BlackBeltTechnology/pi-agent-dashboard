import { useCallback, useContext, useState } from "react";
import { FilePreviewContext, type FilePreviewTarget } from "../FilePreviewContext.js";
import type { ToolContext } from "./types.js";

export interface FileOpenRouting {
  /** Session cwd from context (preview overlay needs it). */
  cwd?: string;
  /**
   * Route a click to the in-dashboard preview overlay. No-op without `cwd`.
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
 * Single source of truth for the file-open routing shared by `FileLink` and
 * `OpenFileButton` (D5). Routes to the in-dashboard preview overlay; the
 * split-pane open is handled by the consumers via `useOptionalSplitWorkspace`.
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
  const { cwd } = context;
  const provider = useContext(FilePreviewContext);
  const [localTarget, setLocalTarget] = useState<FilePreviewTarget | null>(null);
  const hostManaged = provider != null;
  const open = provider ? provider.open : setLocalTarget;

  const openFile = useCallback(
    (path: string, line?: number) => {
      if (!cwd) return; // no cwd → nothing actionable
      open({ cwd, path, line });
    },
    [cwd, open],
  );

  return {
    cwd,
    openFile,
    hostManaged,
    previewTarget: hostManaged ? null : localTarget,
    closePreview: () => setLocalTarget(null),
  };
}
