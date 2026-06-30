/**
 * Editor pane shell — composes the tab strip, the collapsible file-tree rail,
 * and the active viewer (resolved via the viewer registry). Replaces ChatView
 * in the content area, mirroring FileDiffView. Read-only in v1.
 *
 * See change: add-internal-monaco-editor-pane.
 */

import { fileKind, type ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiArrowLeft, mdiFileTreeOutline, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Suspense, useEffect, useState } from "react";
import { useEditorPaneState } from "../../lib/editor-pane-state.js";
import { EditorFileTree } from "./EditorFileTree.js";
import { EditorTabs } from "./EditorTabs.js";
import { viewerRegistry } from "./viewer-registry.js";

interface EditorPaneProps {
  sessionId: string;
  cwd: string;
  initialFile?: string | null;
  initialLine?: number | null;
  onBack: () => void;
}

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

export function EditorPane({ sessionId, cwd, initialFile, initialLine, onBack }: EditorPaneProps) {
  const [state, dispatch] = useEditorPaneState(sessionId);
  const [treeVisible, setTreeVisible] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Open the route-requested file on mount / when it changes.
  useEffect(() => {
    if (initialFile) {
      const viewer = fileKind(absOf(cwd, initialFile)).viewer;
      dispatch({ type: "openFile", path: initialFile, viewer });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, cwd]);

  const activeTab = state.activeIndex >= 0 ? state.openFiles[state.activeIndex] : null;
  const activePath = activeTab?.path ?? null;

  const openFile = (relPath: string, viewer: ViewerKind) => dispatch({ type: "openFile", path: relPath, viewer });

  let body: React.ReactNode;
  if (!activeTab) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
        No files open — pick one from the tree.
      </div>
    );
  } else {
    const classification = fileKind(absOf(cwd, activeTab.path));
    const Viewer = viewerRegistry[activeTab.viewer];
    const lineForTab = activeTab.path === initialFile ? (initialLine ?? undefined) : undefined;
    body = (
      <Suspense fallback={<div className="p-4 text-sm text-[var(--text-tertiary)]">Loading viewer…</div>}>
        <Viewer
          key={`${activeTab.path}:${refreshNonce}`}
          cwd={cwd}
          path={activeTab.path}
          kind={classification.kind}
          mimeType={classification.mimeType}
          size={0}
          line={lineForTab}
        />
      </Suspense>
    );
  }

  const language = activeTab ? activeTab.path.slice(activeTab.path.lastIndexOf(".") + 1) : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2">
        <button type="button" onClick={onBack} className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Back to chat">
          <Icon path={mdiArrowLeft} size={0.6} className="mr-0.5 inline" />Back
        </button>
        <button
          type="button"
          onClick={() => setTreeVisible((v) => !v)}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          title={treeVisible ? "Hide file tree" : "Show file tree"}
        >
          <Icon path={mdiFileTreeOutline} size={0.7} />
        </button>
        <span className="truncate text-sm font-medium">{activePath ?? "Editor"}</span>
        <span className="flex-1" />
        {activeTab && (
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title="Reload file"
          >
            <Icon path={mdiRefresh} size={0.7} />
          </button>
        )}
      </div>

      {/* Tabs */}
      {state.openFiles.length > 0 && (
        <EditorTabs
          openFiles={state.openFiles}
          activeIndex={state.activeIndex}
          onActivate={(i) => dispatch({ type: "setActive", index: i })}
          onClose={(i) => dispatch({ type: "closeTab", index: i })}
          onReorder={(from, to) => dispatch({ type: "reorderTabs", from, to })}
        />
      )}

      {/* Tree + viewer */}
      <div className="flex min-h-0 flex-1">
        {treeVisible && (
          <div className="w-56 shrink-0">
            <EditorFileTree
              cwd={cwd}
              treeOpenRoots={state.treeOpenRoots}
              onToggleRoot={(relPath) => dispatch({ type: "toggleTreeRoot", relPath })}
              onOpenFile={openFile}
              activePath={activePath}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">{body}</div>
      </div>

      {/* Status footer */}
      {activeTab && (
        <div className="flex shrink-0 items-center gap-3 border-t border-[var(--border-primary)] px-3 py-1 text-xs text-[var(--text-tertiary)]">
          <span>{activeTab.viewer}</span>
          {language && <span>{language}</span>}
          <span className="truncate">{activePath}</span>
        </div>
      )}
    </div>
  );
}
