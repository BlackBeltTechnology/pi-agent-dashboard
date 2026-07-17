/**
 * Editor pane shell — composes the tab strip, the collapsible + resizable
 * file-tree rail, and the active viewer (resolved via the viewer registry).
 * Co-mounts alongside `ChatView` inside `SplitWorkspace`. Read-only in v1.
 *
 * State (open tabs, tree expansion) and the file-open plumbing come from
 * `SplitWorkspaceContext` so tree clicks, chat file-links, and search results
 * all funnel through one `openInSplit`. The inner rail↔viewer divider resizes
 * the rail independently of the outer chat/editor split.
 *
 * See change: add-internal-monaco-editor-pane, split-editor-workspace.
 */

import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiClose, mdiConsoleLine, mdiFileTreeOutline, mdiMagnify, mdiRefresh, mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { grepContents } from "../../lib/grep-api.js";
import { useI18n } from "../../lib/i18n";
import { useRailWidth } from "../../lib/rail-width.js";
import { useTreeVisible } from "../../lib/tree-visible.js";
import { stripTermId } from "../../lib/use-terminal-pane-tabs.js";
import { SplitDivider } from "../SplitDivider.js";
import { useSplitWorkspace } from "../SplitWorkspaceContext.js";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner.js";
import { ChangesRailSection } from "./ChangesRailSection.js";
import { EditorFileTree } from "./EditorFileTree.js";
import { EditorSearchPanel } from "./EditorSearchPanel.js";
import { EditorTabs } from "./EditorTabs.js";
import { TerminalPaneLayer } from "./TerminalPaneLayer.js";
import { viewerRegistry } from "./viewer-registry.js";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

export function EditorPane() {
  const { t } = useI18n();
  const {
    sessionId,
    cwd,
    paneState: state,
    dispatch,
    updateSplit,
    openInSplit,
    pendingScroll,
    consumePendingScroll,
    fileResults,
    onFilenameSearch,
    changedFiles,
    clearChanged,
    changesRevealSignal,
    openDiffTab,
    terminal,
  } = useSplitWorkspace();
  const terminalTitle = useCallback(
    (id: string) => {
      const s = terminal.terminals.find((t) => t.id === id);
      return s?.title || s?.shell?.split("/").pop() || undefined;
    },
    [terminal.terminals],
  );
  const [treeVisible, setTreeVisible] = useTreeVisible(sessionId);
  // Rail-local `this session only` (D3 — NOT lifted to context; that would
  // break the FileDiffView takeover, which renders DiffFileTree outside the
  // SplitWorkspaceProvider). Shared by the summary bar + the tree's other-
  // changes group; ephemeral, resets each mount.
  const [sessionOnly, setSessionOnly] = useState(false);
  // Reset the filter when the pane is reused for a different session.
  useEffect(() => setSessionOnly(false), [sessionId]);

  // openChanges() (the Changed Files chip) bumps changesRevealSignal to request
  // the Changes rail. The tree rail defaults to collapsed (change:
  // collapse-files-panel-by-default), so reveal it here — otherwise the split
  // opens but ChangesRailSection (mounted only when treeVisible) stays hidden
  // and the chip appears to do nothing. Skip the initial mount value so it does
  // not fight a user's collapse choice. See change: detect-tool-created-files.
  const prevRevealRef = useRef(changesRevealSignal);
  useEffect(() => {
    if (changesRevealSignal !== prevRevealRef.current) {
      prevRevealRef.current = changesRevealSignal;
      setTreeVisible(true);
    }
  }, [changesRevealSignal, setTreeVisible]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [railWidth, setRailWidth] = useRailWidth(sessionId);

  // Cmd/Ctrl-P (filenames) or Cmd/Ctrl-Shift-F (contents) toggles the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "p" || e.key === "P" || (e.shiftKey && (e.key === "f" || e.key === "F"))) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onContentSearch = useCallback(
    (q: string, regex: boolean) => grepContents(cwd, q, regex),
    [cwd],
  );
  // Tree+viewer row — its left edge anchors the rail-width drag math so the
  // width stays correct regardless of the outer split ratio.
  const rowRef = useRef<HTMLDivElement>(null);
  // Scroll target for the active tab, latched from the pending-scroll signal.
  const [scrollTo, setScrollTo] = useState<{ path: string; line: number } | null>(null);

  const activeTab = state.activeIndex >= 0 ? state.openFiles[state.activeIndex] : null;
  const activePath = activeTab?.path ?? null;

  // Honour a pending scroll for the active tab exactly once, then clear it.
  useEffect(() => {
    if (pendingScroll && pendingScroll.path === activePath) {
      setScrollTo(pendingScroll);
      consumePendingScroll();
    }
  }, [pendingScroll, activePath, consumePendingScroll]);

  const lineForTab = scrollTo && scrollTo.path === activePath ? scrollTo.line : undefined;

  let body: React.ReactNode;
  if (!activeTab) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
        {t("editor.noFilesOpen", undefined, "No files open — pick one from the tree.")}
      </div>
    );
  } else {
    const classification = fileKind(absOf(cwd, activeTab.path));
    const Viewer = viewerRegistry[activeTab.viewer];
    body = (
      <Suspense fallback={<div className="p-4 text-sm text-[var(--text-tertiary)]">{t("editor.loadingViewer", undefined, "Loading viewer…")}</div>}>
        <Viewer
          key={`${activeTab.path}:${refreshNonce}:${lineForTab ?? ""}`}
          cwd={cwd}
          path={activeTab.path}
          kind={classification.kind}
          mimeType={classification.mimeType}
          size={0}
          line={lineForTab}
          restrictCsp={activeTab.restrictCsp}
        />
      </Suspense>
    );
  }

  const language = activeTab ? activeTab.path.slice(activeTab.path.lastIndexOf(".") + 1) : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2">
        {/* Always-visible EDITOR caption, folded into the existing header row
            (not a second bar). The active file name follows in the span below.
            See change: redesign-split-layout-controls. */}
        <span
          data-testid="pane-caption-editor"
          className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]"
        >
          <span className="h-1.5 w-1.5 rounded-sm bg-[#22c55e] opacity-70" />
          {t("layout.editor", undefined, "Editor")}
        </span>
        <button
          type="button"
          onClick={() => setTreeVisible(!treeVisible)}
          aria-pressed={treeVisible}
          aria-label={t("editor.toggleFileTree", undefined, "Toggle file tree")}
          data-testid="tree-toggle"
          className={[
            "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium",
            treeVisible
              ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          ].join(" ")}
          title={treeVisible ? t("editor.hideFileTree", undefined, "Hide file tree") : t("editor.showFileTree", undefined, "Show file tree")}
        >
          <Icon path={mdiFileTreeOutline} size={0.7} />
          <span>{t("common.files", undefined, "Files")}</span>
        </button>
        <span className="truncate text-sm font-medium">{activePath ?? t("editor.editorTitle", undefined, "Editor")}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => dispatch({ type: "openFile", path: "live:preview", viewer: "live-server" })}
          data-testid="live-preview-launch"
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          title={t("editor.previewLocalDevServer", undefined, "Preview a local dev server")}
        >
          <Icon path={mdiWeb} size={0.7} />
        </button>
        <button
          type="button"
          onClick={() => terminal.createTerminal()}
          data-testid="new-terminal-launch"
          className="text-[var(--text-tertiary)] hover:text-cyan-400"
          title={t("terminal.newTerminal", undefined, "New Terminal")}
        >
          <Icon path={mdiConsoleLine} size={0.7} />
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          aria-pressed={searchOpen}
          data-testid="editor-search-toggle"
          className={searchOpen ? "text-blue-400" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}
          title={t("editor.searchShortcutHint", undefined, "Search (Cmd-P / Cmd-Shift-F)")}
        >
          <Icon path={mdiMagnify} size={0.7} />
        </button>
        {activeTab && (
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title={t("editor.reloadFile", undefined, "Reload file")}
          >
            <Icon path={mdiRefresh} size={0.7} />
          </button>
        )}
        <button
          type="button"
          onClick={() => updateSplit({ mode: "closed" })}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          title={t("editor.closeEditor", undefined, "Close editor")}
        >
          <Icon path={mdiClose} size={0.7} />
        </button>
      </div>

      {/* Tabs */}
      {state.openFiles.length > 0 && (
        <EditorTabs
          openFiles={state.openFiles}
          activeIndex={state.activeIndex}
          terminalTitle={terminalTitle}
          onActivate={(i) => dispatch({ type: "setActive", index: i })}
          onClose={(i) => {
            const f = state.openFiles[i];
            const termId = f?.viewer === "terminal" ? stripTermId(f.path) : null;
            // D4 — closing a terminal tab kills its terminal.
            if (termId) terminal.closeTerminalTab(termId);
            else dispatch({ type: "closeTab", index: i });
          }}
          onReorder={(from, to) => dispatch({ type: "reorderTabs", from, to })}
        />
      )}

      {/* Tree + inner divider + viewer */}
      <div ref={rowRef} className="flex min-h-0 flex-1">
        {treeVisible && (
          <>
            <div className="shrink-0 flex min-h-0 flex-col" style={{ width: railWidth }}>
              {/* Changes section pinned atop the project-tree rail (change:
                  add-change-summary-table). Absent when no changes. */}
              <ChangesRailSection sessionOnly={sessionOnly} onSessionOnlyChange={setSessionOnly} />
              <div className="min-h-0 flex-1 overflow-hidden">
                <EditorFileTree
                  cwd={cwd}
                  treeOpenRoots={state.treeOpenRoots}
                  onToggleRoot={(relPath) => dispatch({ type: "toggleTreeRoot", relPath })}
                  onOpenFile={(relPath) => openInSplit(relPath)}
                  onOpenDiff={(relPath) => openDiffTab(relPath)}
                  activePath={activePath}
                  sessionOnly={sessionOnly}
                />
              </div>
            </div>
            <SplitDivider
              orientation="h"
              onResize={(clientX) => {
                const left = rowRef.current?.getBoundingClientRect().left ?? 0;
                setRailWidth(clientX - left);
              }}
              data-testid="rail-divider"
              title={t("editor.dragResizeRail", undefined, "Drag to resize the browse rail")}
            />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {searchOpen && (
            <EditorSearchPanel
              cwd={cwd}
              fileResults={fileResults}
              onFilenameSearch={onFilenameSearch}
              onContentSearch={onContentSearch}
              onOpen={(relPath, line) => openInSplit(relPath, line)}
              onClose={() => setSearchOpen(false)}
            />
          )}
          {activePath && changedFiles?.has(activePath) && (
            <ChangedOnDiskBanner
              fileName={activePath}
              onRefresh={() => {
                setRefreshNonce((n) => n + 1);
                clearChanged(activePath);
              }}
              onDismiss={() => clearChanged(activePath)}
            />
          )}
          {/* File viewer + keep-alive terminal layer share the body region.
              When a file tab is active the terminals are display:none; when a
              term tab is active `body` is the null placeholder and the layer's
              active terminal fills. See change: terminals-in-tabbed-panes. */}
          <div className="min-h-0 flex-1 flex flex-col">
            {body}
            <TerminalPaneLayer />
          </div>
        </div>
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
