import { useCallback, useState } from "react";
import { isLocalhost, openEditor } from "../../lib/editor-api.js";
import type { ToolContext } from "./types.js";

/** Pending preview target ({@link FilePreviewOverlay}) or `null` when closed. */
export interface PreviewTarget {
  path: string;
  line?: number;
}

export interface FileOpenRouting {
  /** Session cwd from context (preview overlay needs it). */
  cwd?: string;
  /** True when the dashboard is on localhost AND ≥1 editor is detected. */
  localEditorAvailable: boolean;
  /** Name of the first detected editor, when available. */
  editorName?: string;
  /** Currently-open preview target, or `null`. */
  preview: PreviewTarget | null;
  /**
   * Route a click: localhost + editor → `POST /api/open-editor`;
   * otherwise → open the in-dashboard preview overlay. No-op without `cwd`.
   */
  openFile: (path: string, line?: number) => Promise<void> | void;
  /** Close the preview overlay. */
  closePreview: () => void;
}

/**
 * Single source of truth for the open-vs-preview routing shared by
 * `FileLink` and `OpenFileButton` (D5). Keeps the decision and the
 * preview-overlay state in one place so both surfaces behave identically.
 *
 * See change: unify-file-link-openability (spec: open-in-editor).
 */
export function useFileOpenRouting(context: ToolContext): FileOpenRouting {
  const { cwd, editors } = context;
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const localEditorAvailable = isLocalhost() && editors.length > 0;

  const openFile = useCallback(
    async (path: string, line?: number) => {
      if (!cwd) return; // no cwd → nothing actionable
      if (localEditorAvailable) {
        await openEditor(cwd, editors[0].id, path, line);
      } else {
        setPreview({ path, line });
      }
    },
    [cwd, editors, localEditorAvailable],
  );

  return {
    cwd,
    localEditorAvailable,
    editorName: editors[0]?.name,
    preview,
    openFile,
    closePreview: () => setPreview(null),
  };
}
