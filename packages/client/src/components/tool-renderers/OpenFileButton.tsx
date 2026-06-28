import { mdiEyeOutline, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import type { ToolContext } from "./types.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";

interface Props {
  filePath?: string;
  line?: number;
  context: ToolContext;
}

/**
 * Open affordance for Read/Edit/Write tool headers. Routes clicks via the
 * shared {@link useFileOpenRouting} hook, mirroring `FileLink`:
 *   localhost + detected editor → open in editor
 *   otherwise                   → in-dashboard preview overlay
 *
 * Renders nothing only when there is no `cwd` or no `filePath` — never merely
 * because no editor is detected (that case falls back to preview).
 *
 * See change: unify-file-link-openability (spec: open-in-editor).
 */
export function OpenFileButton({ filePath, line, context }: Props) {
  const { cwd, localEditorAvailable, editorName, openFile, hostManaged, previewTarget, closePreview } =
    useFileOpenRouting(context);
  if (!cwd || !filePath) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void openFile(filePath, line);
  };

  const label = localEditorAvailable ? editorName : "Preview";
  const title = localEditorAvailable ? `Open in ${editorName}` : `Preview ${filePath}`;

  return (
    <>
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-blue-400 transition-colors"
      title={title}
    >
      <Icon path={localEditorAvailable ? mdiOpenInNew : mdiEyeOutline} size={0.45} />
      <span>{label}</span>
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
