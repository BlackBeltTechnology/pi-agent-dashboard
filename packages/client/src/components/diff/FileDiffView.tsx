/**
 * FileDiffView — split-pane view showing changed files (tree) and diffs (panel).
 * Replaces ChatView in the content area when activated.
 */

import { mdiArrowLeft, mdiFileTreeOutline, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { useSessionDiff } from "../../hooks/useSessionDiff.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DiffFileTree, type FileSelection } from "./DiffFileTree.js";
import { DiffPanel } from "./DiffPanel.js";

interface FileDiffViewProps {
  sessionId: string;
  onBack: () => void;
}

export function FileDiffView({ sessionId, onBack }: FileDiffViewProps) {
  const { data, isLoading, error, refresh } = useSessionDiff(sessionId);
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [mobileShowTree, setMobileShowTree] = useState(true);
  const isMobile = useMobile();

  const handleSelect = useCallback((sel: FileSelection) => {
    setSelection(sel);
    if (isMobile) setMobileShowTree(false);
  }, [isMobile]);

  const selectedFile = selection
    ? data?.files.find((f) => f.path === selection.filePath) ?? null
    : null;

  // Auto-select first file when data loads
  if (data?.files.length && !selection) {
    const first = data.files[0];
    setSelection({ filePath: first.path, changeIndex: null });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] shrink-0">
        <button
          onClick={onBack}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm"
          title={i18nT("session.backToChat", undefined, "Back to chat")}
        >
          <Icon path={mdiArrowLeft} size={0.6} className="inline mr-0.5" />{i18nT("common.back2", undefined, "Back")}
        </button>
        <span className="text-sm font-medium">{i18nT("diff.changedFiles", undefined, "Changed Files")}</span>
        {!data?.isGitRepo && data && (
          <span className="text-xs text-[var(--text-tertiary)] ml-1">{i18nT("git.noGit", undefined, "(no git)")}</span>
        )}
        <span className="flex-1" />
        {isMobile && !mobileShowTree && (
          <button
            onClick={() => setMobileShowTree(true)}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <Icon path={mdiFileTreeOutline} size={0.45} className="inline mr-0.5" />{i18nT("common.files", undefined, "Files")}
          </button>
        )}
        <button
          onClick={refresh}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          title={i18nT("common.refresh", undefined, "Refresh")}
        >
          <Icon path={mdiRefresh} size={0.5} className="inline mr-0.5" />{i18nT("common.refresh", undefined, "Refresh")}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center flex-1 text-[var(--text-tertiary)]">
          {i18nT("status.loadingFileChanges", undefined, "Loading file changes...")}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[var(--text-tertiary)]">
          <span>{i18nT("common.error", undefined, "Error:")} {error}</span>
          <button
            onClick={refresh}
            className="text-xs px-3 py-1 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <Icon path={mdiRefresh} size={0.5} className="inline mr-0.5" />{i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      )}

      {/* Empty */}
      {data && data.files.length === 0 && !isLoading && (
        <div className="flex items-center justify-center flex-1 text-[var(--text-tertiary)]">
          {i18nT("common.noFileChangesDetectedInThis", undefined, "No file changes detected in this session")}
        </div>
      )}

      {/* Content: split pane */}
      {data && data.files.length > 0 && !isLoading && (
        isMobile ? (
          // Mobile: stacked
          <div className="flex-1 min-h-0 overflow-hidden">
            {mobileShowTree ? (
              <DiffFileTree
                files={data.files}
                selection={selection}
                onSelect={handleSelect}
                totalAdditions={data.totalAdditions}
                totalDeletions={data.totalDeletions}
              />
            ) : selectedFile && selection ? (
              <DiffPanel file={selectedFile} selection={selection} sessionId={sessionId} />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
                {i18nT("common.selectAFile", undefined, "Select a file")}
              </div>
            )}
          </div>
        ) : (
          // Desktop: side-by-side
          <div className="flex flex-1 min-h-0">
            <ResizableTreePanel>
              <DiffFileTree
                files={data.files}
                selection={selection}
                onSelect={handleSelect}
                totalAdditions={data.totalAdditions}
                totalDeletions={data.totalDeletions}
              />
            </ResizableTreePanel>
            <div className="flex-1 min-w-0 overflow-hidden">
              {selectedFile && selection ? (
                <DiffPanel file={selectedFile} selection={selection} sessionId={sessionId} />
              ) : (
                <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
                  {i18nT("common.selectAFileToViewChanges", undefined, "Select a file to view changes")}
                </div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

const DEFAULT_TREE_WIDTH = 250;
const MIN_TREE_WIDTH = 150;
const MAX_TREE_WIDTH = 500;

function ResizableTreePanel({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_TREE_WIDTH);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !panelRef.current) return;
      const rect = panelRef.current.parentElement?.getBoundingClientRect();
      const newWidth = e.clientX - (rect?.left ?? 0);
      const clamped = Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, newWidth));
      panelRef.current.style.width = `${clamped}px`;
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const rect = panelRef.current?.parentElement?.getBoundingClientRect();
      const newWidth = e.clientX - (rect?.left ?? 0);
      setWidth(Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, newWidth)));
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  return (
    <div
      ref={panelRef}
      className="flex shrink-0 relative"
      style={{ width }}
    >
      <div className="flex-1 overflow-hidden flex flex-col border-r border-[var(--border-primary)]">
        {children}
      </div>
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 shrink-0"
      />
    </div>
  );
}
