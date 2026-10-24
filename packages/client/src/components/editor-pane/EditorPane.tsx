/**
 * Editor pane shell — composes the tab strip, the collapsible + resizable
 * file-tree rail, and the active viewer. Viewer resolution is split by open
 * path: the four pseudo-tab kinds render from `pseudoTabRegistry` directly,
 * every other kind goes through `CappedViewer` (size gate + `viewerRegistry`).
 * See change: cleanup-import-cycles (D3).
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
import { mdiChevronDown, mdiClose, mdiFileTreeOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { grepContents } from "../../lib/api/grep-api.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { ancestorDirs } from "../../lib/layout/editor-pane-state.js";
import { clampRailWidth, useRailWidth } from "../../lib/layout/rail-width.js";
import { stripTermId } from "../../lib/layout/use-terminal-pane-tabs.js";
import { copyText } from "../../lib/util/clipboard.js";
import { useTreeVisible } from "../../lib/util/tree-visible.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import { SplitDivider } from "../split/SplitDivider.js";
import { useSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { TerminalLimitNotice } from "../terminal/TerminalLimitNotice.js";
import { BulkCloseConfirm } from "./BulkCloseConfirm.js";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner.js";
import { ChangesRailSection } from "./ChangesRailSection.js";
import { DocumentBar } from "./DocumentBar.js";
import { EditorFileTree } from "./EditorFileTree.js";
import { EditorSearchPanel, type Mode as SearchMode } from "./EditorSearchPanel.js";
import { EditorTabs } from "./EditorTabs.js";
import { type BulkClosePlan, type BulkRiskEntry, planBulkClose } from "./file-handler/close-risk.js";
import { FileHandlerAnchor } from "./file-handler/FileHandlerAnchor.js";
import { isUnderSessionCwd } from "./file-handler/file-handler-claims.js";
import { type FileModeOffers, FileModeOffersContext } from "./file-handler/file-mode-offers.js";
import { useFileHandlerPane } from "./file-handler/use-file-handler-pane.js";

// D3 (change: add-lazy-terminal-diff-bootstrap): the keep-alive terminal layer
// is a lazy boundary. `React.lazy` fires its import as soon as it is rendered,
// so the mount is gated on the sticky `terminalActivated` latch — NOT on "a
// terminal tab exists" (already true on a reload with persisted term tabs and
// on every folder pane).
const TerminalPaneLayer = lazy(() => import("./TerminalPaneLayer.js").then((m) => ({ default: m.TerminalPaneLayer })));

import {
  EditorPaneTabLabelSlot,
  useShellSessionOrNull,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { useServerCapabilities } from "../../hooks/useServerCapabilities.js";
import { PreviewProvenance } from "../../lib/access-grants/preview-provenance.js";
import { CappedViewer } from "./CappedViewer.js";
import { NewTabMenu } from "./NewTabMenu.js";
import { PluginTabHost, pluginTabPrefix } from "./PluginTabHost.js";
import { pseudoTabRegistry } from "./pseudo-tab-registry.js";
import { TabContextMenu } from "./TabContextMenu.js";
import { TabSearchPopover } from "./TabSearchPopover.js";
import { basename } from "./tab-labels.js";
import { isPseudoTabViewer, type OpenPathViewer } from "./viewer-kinds.js";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

/** Pane width below which the document bar folds (design D3). */
const NARROW_PX = 640;

/** `true` while the observed element is narrower than `NARROW_PX` (no observer → never narrow). */
function useNarrow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      setNarrow(width < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

/** Search mode a keydown requests: Cmd/Ctrl-P → filenames, Cmd/Ctrl-Shift-F → contents. */
function searchModeForKey(e: KeyboardEvent): SearchMode | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.shiftKey && (e.key === "f" || e.key === "F")) return "content";
  return !e.shiftKey && (e.key === "p" || e.key === "P") ? "file" : null;
}

const riskKey = (e: BulkRiskEntry): string => (e.kind === "terminal" ? `t:${e.id}` : `h:${e.key}`);

export function EditorPane() {
  const { t } = useI18n();
  const {
    sessionId,
    cwd,
    cwdUnavailable,
    paneState: state,
    dispatch,
    updateSplit,
    openInSplit,
    pendingScroll,
    consumePendingScroll,
    fileResults,
    onFilenameSearch,
    hasFileSearch,
    changedFiles,
    clearChanged,
    changeDetection,
    captureBaseline,
    resyncWatch,
    changesRevealSignal,
    openDiffTab,
    terminal,
    terminalActivated,
  } = useSplitWorkspace();
  const terminalTitle = useCallback(
    (id: string) => {
      const s = terminal.terminals.find((t) => t.id === id);
      return s?.title || s?.shell?.split("/").pop() || undefined;
    },
    [terminal.terminals],
  );
  // Plugin tab labels: the claim's label component (always mounted, so a
  // background tab stays live), else the prefix. See change: add-browser-editor-pane-tab.
  const shellSession = useShellSessionOrNull(sessionId);
  const pluginLabel = useCallback(
    (path: string) => <EditorPaneTabLabelSlot path={path} session={shellSession} fallback={pluginTabPrefix(path)} />,
    [shellSession],
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
  // Fail-safe ordering (changed-on-disk verification): a file tab's content
  // baseline is read BEFORE its viewer mounts, so a change landing in between
  // can only produce a false-positive banner, never a silently stale view.
  // `baselineReadyKey` is the `viewerKey` whose baseline has been stored.
  // See change: gate-changed-on-disk-by-content (D2).
  const [baselineReadyKey, setBaselineReadyKey] = useState<string | null>(null);
  const captureBaselineRef = useRef(captureBaseline);
  captureBaselineRef.current = captureBaseline;
  const [railWidth, setRailWidth] = useRailWidth(sessionId);

  // Search is a rail view (design D4): ephemeral `railView` + `searchMode`; the
  // rail renders when the persisted preference says so OR Search is showing.
  // Search never writes the persisted preference. Folder panes have no search.
  const [railView, setRailView] = useState<"files" | "search">("files");
  const [searchMode, setSearchMode] = useState<SearchMode>("file");
  const [searchPrefill, setSearchPrefill] = useState<{ query?: string; nonce: number }>({ nonce: 0 });
  const searchShowing = hasFileSearch && railView === "search";
  const railVisible = treeVisible || searchShowing;
  // Reset the ephemeral search state when the pane is reused for another session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the session id only
  useEffect(() => {
    setRailView("files");
    setSearchMode("file");
  }, [sessionId]);

  // Pane overlays (confirmation, Search-tabs popover, menus): Cmd/Ctrl-W is inert while any is open.
  const [tabSearchOpen, setTabSearchOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const [bulk, setBulk] = useState<{ targets: string[]; plan: BulkClosePlan } | null>(null);
  const [menusOpen, setMenusOpen] = useState({ newTab: false, docMore: false });
  const onNewTabOpen = useCallback((open: boolean) => setMenusOpen((m) => (m.newTab === open ? m : { ...m, newTab: open })), []);
  const onDocMoreOpen = useCallback((open: boolean) => setMenusOpen((m) => (m.docMore === open ? m : { ...m, docMore: open })), []);
  const paneOverlayOpen = !!bulk || tabSearchOpen || !!contextMenu || menusOpen.newTab || menusOpen.docMore;
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(rootRef);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabSearchBtnRef = useRef<HTMLButtonElement>(null);

  const openSearch = useCallback(
    (mode: SearchMode, query?: string) => {
      if (!hasFileSearch) return;
      setSearchMode(mode);
      setRailView("search");
      setSearchPrefill((p) => ({ query, nonce: p.nonce + 1 }));
    },
    [hasFileSearch],
  );
  const closeSearch = useCallback(() => {
    setRailView("files");
    bodyRef.current?.focus();
  }, []);

  // Cmd/Ctrl-P (filenames) or Cmd/Ctrl-Shift-F (contents): same mode closes the
  // view, the other mode switches. Without file search the key is not
  // intercepted (Cmd-P still reaches the browser's Print).
  useEffect(() => {
    if (!hasFileSearch) return;
    const onKey = (e: KeyboardEvent) => {
      const mode = searchModeForKey(e);
      if (!mode) return;
      e.preventDefault();
      if (railView === "search" && searchMode === mode) closeSearch();
      else openSearch(mode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasFileSearch, railView, searchMode, openSearch, closeSearch]);

  const onContentSearch = useCallback(
    (q: string, regex: boolean) => grepContents(cwd, q, regex),
    [cwd],
  );
  // Tree+viewer row — its left edge anchors the rail-width drag math so the
  // width stays correct regardless of the outer split ratio.
  const rowRef = useRef<HTMLDivElement>(null);
  // Rail wrapper: the drag previews its width straight in the DOM and commits
  // once on release. See change: fix-split-divider-drag (D5).
  const railRef = useRef<HTMLDivElement>(null);
  const railLeft = () => rowRef.current?.getBoundingClientRect().left ?? 0;
  // Scroll target for the active tab, latched from the pending-scroll signal.
  const [scrollTo, setScrollTo] = useState<{ path: string; line: number } | null>(null);

  const activeTab = state.activeIndex >= 0 ? state.openFiles[state.activeIndex] : null;
  const activePath = activeTab?.path ?? null;
  // Plugin file-handler modes (session-scoped panes only — `changeDetection` is
  // the session-pane flag). See change: add-editor-pane-file-handlers.
  const fh = useFileHandlerPane({ sessionId, cwd, sessionPane: changeDetection, state, dispatch });
  // The binary notice names the matching modes (D11 A4); same claims + action as the switcher.
  const fhSelect = fh.selectMode;
  const modeOffers = useMemo<FileModeOffers | null>(
    () => (fh.matching.length > 0 && !fh.outsideCwd ? { claims: fh.matching, onSelect: (key) => void fhSelect(key) } : null),
    [fh.matching, fh.outsideCwd, fhSelect],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // Server-advertised host capabilities: `systemOpen` gates Open/Reveal in the
  // document bar, `platform` labels Reveal. See change: open-view-command-in-editor-pane (D9),
  // scope-anchor-editor-pane-controls (D10).
  const caps = useServerCapabilities();

  // Honour a pending scroll for the active tab exactly once, then clear it.
  useEffect(() => {
    if (pendingScroll && pendingScroll.path === activePath) {
      setScrollTo(pendingScroll);
      consumePendingScroll();
    }
  }, [pendingScroll, activePath, consumePendingScroll]);

  const lineForTab = scrollTo && scrollTo.path === activePath ? scrollTo.line : undefined;

  // The mount key of the active FILE tab's viewer (open, activation, Refresh and
  // provenance/line changes all change it); `null` for pseudo/plugin tabs, which
  // are never watched or baselined. `autoOpened` is in the key: a provenance
  // change remounts the tab so its next request uses the new eligibility
  // (surface-denial-remedy-in-previews, D4). Scoped to (session, cwd): a switch drops the
  // per-scope baseline store, so an identical path:nonce key must still recapture one.
  // A handler-mode tab has no built-in viewer: no baseline read here (the handler's
  // `snapshot()` sets the baseline) and `refreshNonce` does not key it.
  const fileViewerKey =
    activeTab && cwd && !isPseudoTabViewer(activeTab.viewer) && !fh.handlerView
      ? `${sessionId}\u0000${cwd}\u0000${activeTab.path}:${refreshNonce}:${lineForTab ?? ""}:${activeTab.autoOpened === true}`
      : null;
  useEffect(() => {
    if (!changeDetection || !fileViewerKey || !activePath) return;
    let active = true;
    void captureBaselineRef.current(activePath).then(() => {
      if (active) setBaselineReadyKey(fileViewerKey);
    });
    return () => {
      active = false;
    };
  }, [changeDetection, fileViewerKey, activePath]);

  let body: React.ReactNode;
  if (!activeTab) {
    body = (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
        {t("editor.noFilesOpen", undefined, "No files open — pick one from the tree.")}
      </div>
    );
  } else {
    const classification = fileKind(absOf(cwd, activeTab.path));
    // NOTE: `classification` is computed for every tab, including pseudo-tab
    // paths where its `.viewer` is wrong (`diff:src/foo.ts` → `monaco`). Only
    // `.kind`/`.mimeType` are consumed. `activeTab.viewer` is the discriminator.
    //
    // Bound to a local so the `isPseudoTabViewer` guard narrows it: the else
    // branch becomes `OpenPathViewer`, which is what lets `tsc` catch a
    // mis-routed kind instead of deferring it to a runtime `<undefined/>`.
    // Never replace this with a cast.
    const viewer = activeTab.viewer;
    const autoOpened = activeTab.autoOpened === true;
    const viewerKey = fileViewerKey ?? "";
    const viewerProps = {
      cwd,
      path: activeTab.path,
      kind: classification.kind,
      mimeType: classification.mimeType,
      size: 0,
      line: lineForTab,
      restrictCsp: activeTab.restrictCsp,
      reloadNonce: activeTab.reloadNonce,
      updatedByAgent: activeTab.updatedByAgent,
    };
    // Plugin tabs render through PluginTabHost (claim by prefix, richer
    // props); never the registry, never CappedViewer (no `/api/file`).
    // See change: add-browser-editor-pane-tab (D1).
    const activeIdx = state.activeIndex;
    const PseudoTabViewerComponent =
      isPseudoTabViewer(viewer) && viewer !== "plugin" ? pseudoTabRegistry[viewer] : null;
    body = (
      <PreviewProvenance autoOpened={autoOpened}>
        <Suspense fallback={<div className="p-4 text-sm text-[var(--text-tertiary)]">{t("editor.loadingViewer", undefined, "Loading viewer…")}</div>}>
          {viewer === "plugin" ? (
            <PluginTabHost
              key={activeTab.path}
              path={activeTab.path}
              sessionId={sessionId}
              isActive
              onClose={() => dispatch({ type: "closeTab", index: activeIdx })}
            />
          ) : PseudoTabViewerComponent ? (
            // A live-server tab keeps per-target state (framed target, token, policy): key it by tab path so
            // two `static:`/`live:` tabs never show each other's page. See change: improve-canvas-html-and-url-ux.
            <PseudoTabViewerComponent key={viewer === "live-server" ? activeTab.path : viewerKey} {...viewerProps} />
          ) : isPseudoTabViewer(viewer) ? null : fh.handlerView && fh.activeKey ? (
            // Plugin file-handler mode: the page-level layer aligns the live
            // instance over this anchor; CappedViewer is NOT mounted.
            <FileHandlerAnchor instanceKey={fh.activeKey} />
          ) : !cwd ? (
            // No folder to read from yet (archived session row still resolving, or its
            // fetch failed): mount no viewer, so no `/api/file?cwd=` request is issued.
            // See change: fix-archived-session-view-header-and-stale-artifact-tab (D4).
            <div data-testid="editor-pane-cwd-pending" className="p-4 text-sm text-[var(--text-tertiary)]">
              {cwdUnavailable
                ? t("session.archivedUnavailable", undefined, "Archived session unavailable")
                : t("session.archivedLoading", undefined, "Loading archived session…")}
            </div>
          ) : changeDetection && baselineReadyKey !== viewerKey ? (
            // Baseline first (D2): the digest round-trip is the price of the
            // fail-safe ordering; a failed digest still resolves (null baseline).
            <div className="p-4 text-sm text-[var(--text-tertiary)]">{t("editor.loadingViewer", undefined, "Loading viewer…")}</div>
          ) : (
            <FileModeOffersContext.Provider value={modeOffers}>
              <CappedViewer key={viewerKey} viewer={viewer} {...viewerProps} />
            </FileModeOffersContext.Provider>
          )}
        </Suspense>
      </PreviewProvenance>
    );
  }

  const language = activeTab ? activeTab.path.slice(activeTab.path.lastIndexOf(".") + 1) : "";

  // ── Closing: single close (per tab) and the bulk runner (design D6) ────────
  const closeTabAt = (i: number) => {
    const f = stateRef.current.openFiles[i];
    const termId = f?.viewer === "terminal" ? stripTermId(f.path) : null;
    // D4 — closing a terminal tab kills its terminal (silent: no confirmation).
    if (termId) terminal.closeTerminalTab(termId);
    else if (f?.handlerMode && changeDetection) {
      // Closing the last tab of a handler instance with unsaved/unknown
      // edits asks first; re-resolve the index afterwards (async).
      void fh.guardTabClose(i).then((ok) => {
        if (!ok) return;
        const idx = stateRef.current.openFiles.findIndex((t) => t.path === f.path);
        if (idx >= 0) dispatch({ type: "closeTab", index: idx });
      });
    } else dispatch({ type: "closeTab", index: i });
  };
  const closeTabByPath = (path: string) => {
    const i = stateRef.current.openFiles.findIndex((f) => f.path === path);
    if (i >= 0) closeTabAt(i);
  };
  // Close popovers first (their Escape listener is not on the escape stack), then
  // either close at once or ask once about the risky tabs.
  const runBulkClose = (paths: string[]) => {
    setTabSearchOpen(false);
    setContextMenu(null);
    const plan = planBulkClose(stateRef.current.openFiles, paths, fh.closeLookups);
    if (plan.targets.length === 0) return;
    if (plan.risky.length === 0) dispatch({ type: "closeTabs", paths: plan.targets });
    else setBulk({ targets: plan.targets, plan });
  };
  // Re-plan against the CURRENT state on confirm; a risk the dialog did not list
  // re-shows the dialog instead of acting (design D6, "recompute on confirm").
  const confirmBulk = (mode: "keep" | "discard") => {
    if (!bulk) return;
    const fresh = planBulkClose(stateRef.current.openFiles, bulk.targets, fh.closeLookups);
    const listed = new Set(bulk.plan.risky.map(riskKey));
    if (fresh.risky.some((e) => !listed.has(riskKey(e)))) {
      setBulk({ targets: bulk.targets, plan: fresh });
      return;
    }
    if (mode === "keep") {
      const kept = new Set(fresh.risky.flatMap((e) => e.tabPaths));
      dispatch({ type: "closeTabs", paths: fresh.targets.filter((p) => !kept.has(p)) });
    } else {
      for (const e of fresh.risky) {
        // Kill only (never `closeTerminalTab`, which would dispatch `closeByPath` first).
        if (e.kind === "terminal") terminal.killTerminal(e.id);
        else fh.discardInstance(e.key);
      }
      dispatch({ type: "closeTabs", paths: fresh.targets });
    }
    setBulk(null);
  };
  const bulkItems = bulk
    ? bulk.plan.risky.map((e) => ({
        key: riskKey(e),
        reason: e.reason,
        name: e.kind === "terminal" ? (terminalTitle(e.id) ?? t("terminal.terminal", undefined, "terminal")) : basename(e.tabPaths[0] ?? ""),
      }))
    : [];

  // ── Rail / tree reveals ────────────────────────────────────────────────────
  const revealFolder = (relPath: string) => {
    dispatch({ type: "expandTreeRoots", relPaths: ancestorDirs(`${relPath}/x`) });
    setRailView("files");
    setTreeVisible(true);
  };
  const showInTree = (path: string) => {
    dispatch({ type: "expandTreeRoots", relPaths: ancestorDirs(path) });
    setRailView("files");
    setTreeVisible(true);
  };
  const toggleFiles = () => {
    if (railVisible) {
      setRailView("files");
      setTreeVisible(false);
    } else setTreeVisible(true);
  };

  const textDeps = useMemo(
    () => ({ terminalTitle, terminalFallback: t("terminal.terminal", undefined, "terminal") }),
    [terminalTitle, t],
  );
  const BAR_BTN =
    "inline-flex h-7 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";
  const contextTab = contextMenu ? state.openFiles[contextMenu.index] : null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {/* Pane bar: Files · tabs · + ··· ⌄ ✕ (design D1) */}
      <div data-testid="pane-bar" className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5">
        <button
          type="button"
          onClick={toggleFiles}
          aria-pressed={railVisible}
          data-testid="tree-toggle"
          className={[
            "flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-medium",
            railVisible
              ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          ].join(" ")}
          title={railVisible ? t("editor.hideFileTree", undefined, "Hide file tree") : t("editor.showFileTree", undefined, "Show file tree")}
        >
          <Icon path={mdiFileTreeOutline} size={0.7} />
          <span>{t("common.files", undefined, "Files")}</span>
        </button>
        {state.openFiles.length > 0 && (
          <EditorTabs
            openFiles={state.openFiles}
            activeIndex={state.activeIndex}
            terminalTitle={terminalTitle}
            pluginLabel={pluginLabel}
            onActivate={(i) => dispatch({ type: "setActive", index: i })}
            onClose={closeTabAt}
            onReorder={(from, to) => dispatch({ type: "reorderTabs", from, to })}
            onContextMenuTab={(index, anchor) => setContextMenu({ index, anchor })}
            closeShortcutSuspended={paneOverlayOpen}
          />
        )}
        <NewTabMenu
          onNewTerminal={() => terminal.createTerminal()}
          onLivePreview={() => dispatch({ type: "openFile", path: "live:preview", viewer: "live-server" })}
          onOpenFile={hasFileSearch ? () => openSearch("file") : undefined}
          onOpenChange={onNewTabOpen}
        />
        <span className="min-w-0 flex-1" />
        <button
          ref={tabSearchBtnRef}
          type="button"
          data-testid="tab-search-toggle"
          disabled={state.openFiles.length === 0}
          aria-haspopup="dialog"
          aria-expanded={tabSearchOpen}
          aria-label={t("editor.searchTabs", undefined, "Search tabs")}
          title={t("editor.searchTabs", undefined, "Search tabs")}
          onClick={() => setTabSearchOpen((v) => !v)}
          className={`${BAR_BTN} w-7`}
        >
          <Icon path={mdiChevronDown} size={0.7} />
        </button>
        <button
          type="button"
          data-testid="editor-pane-close"
          onClick={() => updateSplit({ mode: "closed" })}
          className={`${BAR_BTN} w-7`}
          aria-label={t("editor.closeEditor", undefined, "Close editor")}
          title={t("editor.closeEditor", undefined, "Close editor")}
        >
          <Icon path={mdiClose} size={0.7} />
        </button>
      </div>

      {/* A refused terminal spawn (PTY cap) reports here, under the bar that has the "+".
          See change: harden-server-capability-bounds. */}
      <TerminalLimitNotice cwd={cwd} inline={false} />

      <DocumentBar
        tab={activeTab}
        cwd={cwd}
        narrow={narrow}
        systemOpen={caps.systemOpen}
        platform={caps.platform}
        claims={activeTab && !isPseudoTabViewer(activeTab.viewer) ? fh.matching : []}
        selectedMode={fh.handlerView ? activeTab?.handlerMode : undefined}
        outsideCwd={fh.outsideCwd}
        onSelectMode={(m) => void fh.selectMode(m)}
        terminalTitle={terminalTitle}
        pluginLabel={pluginLabel}
        onReload={() => (fh.handlerView ? void fh.refreshHandler() : setRefreshNonce((n) => n + 1))}
        onShowInTree={() => activePath && showInTree(activePath)}
        onOpenFolder={revealFolder}
        onOverlayChange={onDocMoreOpen}
      />

      {tabSearchOpen && tabSearchBtnRef.current && (
        <TabSearchPopover
          anchorEl={tabSearchBtnRef.current}
          openFiles={state.openFiles}
          activeIndex={state.activeIndex}
          textDeps={textDeps}
          pluginLabel={pluginLabel}
          unsavedPaths={
            new Set(
              state.openFiles
                .filter((f) => {
                  const k = fh.closeLookups.keyOf(f);
                  return !!k && fh.closeLookups.getInstance(k)?.dirty === true;
                })
                .map((f) => f.path),
            )
          }
          hasFileSearch={hasFileSearch}
          onActivate={(path) => {
            const i = stateRef.current.openFiles.findIndex((f) => f.path === path);
            if (i >= 0) dispatch({ type: "setActive", index: i });
          }}
          onCloseTab={closeTabByPath}
          onBulkClose={runBulkClose}
          onFallThrough={(q) => openSearch("file", q)}
          onClose={() => setTabSearchOpen(false)}
        />
      )}

      {contextMenu && contextTab && (
        <TabContextMenu
          anchorEl={contextMenu.anchor}
          isLast={contextMenu.index === state.openFiles.length - 1}
          fileTab={!isPseudoTabViewer(contextTab.viewer) && isUnderSessionCwd(contextTab.path, cwd)}
          onClose={() => setContextMenu(null)}
          onCloseTab={() => closeTabAt(contextMenu.index)}
          onCloseOthers={() => runBulkClose(state.openFiles.filter((_, i) => i !== contextMenu.index).map((f) => f.path))}
          onCloseRight={() => runBulkClose(state.openFiles.slice(contextMenu.index + 1).map((f) => f.path))}
          onCloseAll={() => runBulkClose(state.openFiles.map((f) => f.path))}
          onShowInTree={() => {
            dispatch({ type: "setActive", index: contextMenu.index });
            showInTree(contextTab.path);
          }}
          onCopyPath={() => void copyText(contextTab.path)}
        />
      )}

      {bulk && (
        <BulkCloseConfirm
          items={bulkItems}
          keptCount={bulk.plan.keptCount}
          onCancel={() => setBulk(null)}
          onKeep={() => confirmBulk("keep")}
          onDiscard={() => confirmBulk("discard")}
        />
      )}

      {/* Tree + inner divider + viewer */}
      <div ref={rowRef} className="flex min-h-0 flex-1">
        {railVisible && (
          <>
            <div
              ref={railRef}
              className="shrink-0 flex min-h-0 flex-col"
              style={{ width: railWidth }}
              data-testid="editor-rail"
              onKeyDown={(e) => {
                // Escape closes Search only while focus is inside the rail.
                if (e.key === "Escape" && searchShowing) {
                  e.preventDefault();
                  closeSearch();
                }
              }}
            >
              {hasFileSearch && (
                <div role="tablist" aria-label={t("editor.railView", undefined, "Rail view")} className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-2 py-1">
                  {(
                    [
                      ["files", "rail-view-files", t("common.files", undefined, "Files")],
                      ["search", "editor-search-toggle", t("editor.search", undefined, "Search")],
                    ] as const
                  ).map(([view, testId, label]) => (
                    <button
                      key={view}
                      type="button"
                      role="tab"
                      data-testid={testId}
                      aria-selected={railView === view}
                      onClick={() => {
                        if (view === "files") {
                          setRailView("files");
                          setTreeVisible(true);
                        } else openSearch(searchMode);
                      }}
                      title={view === "search" ? t("editor.searchShortcutHint", undefined, "Search (Cmd-P / Cmd-Shift-F)") : undefined}
                      className={[
                        "inline-flex min-h-6 items-center rounded px-2 text-xs font-medium",
                        railView === view
                          ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                          : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {searchShowing ? (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <EditorSearchPanel
                    cwd={cwd}
                    fileResults={fileResults}
                    onFilenameSearch={onFilenameSearch}
                    onContentSearch={onContentSearch}
                    onOpen={(relPath, line) => openInSplit(relPath, line)}
                    onClose={closeSearch}
                    mode={searchMode}
                    onModeChange={setSearchMode}
                    prefill={searchPrefill}
                  />
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
            <SplitDivider
              orientation="h"
              onResize={(clientX) => {
                if (railRef.current) railRef.current.style.width = `${clampRailWidth(clientX - railLeft())}px`;
              }}
              onResizeEnd={(clientX) => {
                if (clientX !== null) setRailWidth(clientX - railLeft());
              }}
              data-testid="rail-divider"
              title={t("editor.dragResizeRail", undefined, "Drag to resize the browse rail")}
            />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {activePath && changedFiles?.has(activePath) && (
            <ChangedOnDiskBanner
              fileName={activePath}
              onRefresh={() => {
                if (fh.handlerView) {
                  // Handler tab: guard, then re-mount the handler from a fresh
                  // snapshot; the banner clears only once that proceeds (Cancel
                  // leaves it shown). See change: add-editor-pane-file-handlers (D5).
                  void fh.refreshHandler().then((ok) => {
                    if (!ok) return;
                    clearChanged(activePath);
                    resyncWatch();
                  });
                  return;
                }
                setRefreshNonce((n) => n + 1);
                clearChanged(activePath);
                // Re-declare the open set so a key the server dropped (a long
                // delete) is restored. See change: gate-changed-on-disk-by-content (D5).
                resyncWatch();
              }}
              onDismiss={() => clearChanged(activePath)}
            />
          )}
          {/* File viewer + keep-alive terminal layer share the body region.
              When a file tab is active the terminals are display:none; when a
              term tab is active `body` is the null placeholder and the layer's
              active terminal fills. See change: terminals-in-tabbed-panes. */}
          <div ref={bodyRef} tabIndex={-1} data-testid="editor-pane-body" className="min-h-0 flex-1 flex flex-col focus:outline-none">
            {body}
            {/* D3: mount the lazy layer only once a terminal tab has been the
                active tab. The `Suspense` fallback fills the same pane-body
                region (`min-h-0 flex-1`) so the pane does not collapse while
                the chunk loads. Once latched it stays mounted, preserving the
                keep-alive contract on file-tab switches. */}
            {terminalActivated && (
              // ErrorBoundary guards the chunk-fetch FETCH phase: a rejected
              // `import()` throws during render, and without a boundary React
              // unmounts the whole tree (blank app). Contained here, the shell,
              // tab strip and chat stay interactive. See change:
              // add-lazy-terminal-diff-bootstrap.
              <ErrorBoundary
                fallback={
                  <div className="min-h-0 flex-1 p-3 text-xs text-[var(--text-tertiary)]" data-testid="terminal-layer-error">
                    {t("editor.terminalLoadFailed", undefined, "Terminal failed to load.")}
                  </div>
                }
              >
                <Suspense fallback={<div className="min-h-0 flex-1" data-testid="terminal-layer-loading" />}>
                  <TerminalPaneLayer />
                </Suspense>
              </ErrorBoundary>
            )}
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
