import { mdiEyeOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useLocation } from "wouter";
import { useI18n } from "../../lib/i18n/i18n.js";
import { buildEditorUrl } from "../../lib/nav/route-builders.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import type { ToolContext } from "./types.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";

interface Props {
  filePath?: string;
  line?: number;
  context: ToolContext;
}

/**
 * "Open" affordance for Read/Edit/Write tool headers.
 *
 * Body click → open in the internal Monaco editor pane: the live split when
 * available for this session, else a deep-link to `/session/:id/editor`, else
 * the preview overlay when no session context exists.
 *
 * Renders whenever a `cwd` + `filePath` are present.
 *
 * See change: add-internal-monaco-editor-pane (spec: open-in-editor).
 */
export function OpenFileButton({ filePath, line, context }: Props) {
  const { t } = useI18n();
  const { cwd, sessionId } = context;
  const [, navigate] = useLocation();
  const { openFile, hostManaged, previewTarget, closePreview } = useFileOpenRouting(context);
  const ws = useOptionalSplitWorkspace();

  if (!cwd || !filePath) return null;

  const openInternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ws && sessionId && ws.sessionId === sessionId) {
      // In-dashboard split is live for this session — open without a route swap.
      ws.openInSplit(filePath, line);
    } else if (sessionId) {
      // Deep-link fallback (cross-session / no provider): the route reopens the split.
      navigate(buildEditorUrl(sessionId, filePath, line));
    } else {
      // No session context to build a route — preserve a working open path.
      void openFile(filePath, line);
    }
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={openInternal}
        className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-blue-400"
        title={t("editor.openFileTitle", { path: filePath }, "Open {path}")}
      >
        <Icon path={mdiEyeOutline} size={0.45} />
        <span>{t("editor.openExternal", undefined, "Open")}</span>
      </button>
      {!hostManaged && previewTarget && (
        <FilePreviewOverlay
          cwd={previewTarget.cwd}
          path={previewTarget.path}
          line={previewTarget.line}
          onClose={closePreview}
        />
      )}
    </span>
  );
}
