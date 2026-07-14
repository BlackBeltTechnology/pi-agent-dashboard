import { mdiChevronDown, mdiEyeOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { isLocalhost, openEditor } from "../../lib/editor-api.js";
import { useI18n } from "../../lib/i18n";
import { buildEditorUrl } from "../../lib/route-builders.js";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import { useOptionalSplitWorkspace } from "../SplitWorkspaceContext.js";
import type { ToolContext } from "./types.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";

interface Props {
  filePath?: string;
  line?: number;
  context: ToolContext;
}

/**
 * Split-button "Open" affordance for Read/Edit/Write tool headers.
 *
 *   - Body click → open in the internal Monaco editor pane (`/session/:id/editor`).
 *   - Caret dropdown → detected native editors (Zed, …) via `openEditor`.
 *   - No native editors → plain "Open" button, no caret.
 *
 * Renders whenever a `cwd` + `filePath` are present — never hidden merely
 * because no native editor exists (the prior behavior). When no `sessionId` is
 * available to build the route, falls back to the legacy preview/editor routing.
 *
 * See change: add-internal-monaco-editor-pane (spec: open-in-editor).
 */
export function OpenFileButton({ filePath, line, context }: Props) {
  const { t } = useI18n();
  const { cwd, sessionId, editors } = context;
  const [, navigate] = useLocation();
  const { openFile, hostManaged, previewTarget, closePreview } = useFileOpenRouting(context);
  const ws = useOptionalSplitWorkspace();

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const nativeEditors = isLocalhost() ? editors : [];

  useEffect(() => {
    if (menuOpen) {
      setActiveItem(0);
      menuRef.current?.focus();
    }
  }, [menuOpen]);

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

  const openInEditor = async (editorId: string) => {
    setLaunchError(null);
    const res = await openEditor(cwd, editorId, filePath, line);
    if (res.success) {
      setMenuOpen(false);
    } else {
      setLaunchError(res.error ?? t("editor.failedToOpenInEditor", undefined, "Failed to open in editor"));
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveItem((i) => Math.min(i + 1, nativeEditors.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveItem((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const ed = nativeEditors[activeItem];
      if (ed) void openInEditor(ed.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
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
      {nativeEditors.length > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("editor.moreOpenOptions", undefined, "More open options")}
          className="ml-0.5 text-[var(--text-tertiary)] transition-colors hover:text-blue-400"
        >
          <Icon path={mdiChevronDown} size={0.45} />
        </button>
      )}
      {menuOpen && nativeEditors.length > 0 && (
        <ul
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          onBlur={() => setMenuOpen(false)}
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded border border-[var(--border-secondary)] bg-[var(--bg-surface)] py-1 text-xs shadow-lg outline-none"
        >
          {launchError && (
            <li className="px-3 py-1 text-[var(--accent-red)]">{launchError}</li>
          )}
          {nativeEditors.map((ed, i) => (
            <li
              key={ed.id}
              role="menuitem"
              onMouseEnter={() => setActiveItem(i)}
              onClick={(e) => {
                e.stopPropagation();
                void openInEditor(ed.id);
              }}
              className={[
                "cursor-pointer px-3 py-1",
                i === activeItem ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
              ].join(" ")}
            >
              {t("editor.openInEditor", { name: ed.name }, "Open in {name}")}
            </li>
          ))}
        </ul>
      )}
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
