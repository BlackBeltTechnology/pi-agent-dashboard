/**
 * Per-session split-workspace coordination context.
 *
 * Lifts the split state (`useSplitState`) and the editor-pane state
 * (`useEditorPaneState`) into one provider mounted around the content area, so
 * three otherwise-disconnected consumers can coordinate:
 *   - the session-header split/unsplit toggle,
 *   - every file-open entry point (chat file-link, tool-result path, tree
 *     click, search-result select) via `openInSplit`,
 *   - the `SplitWorkspace` layout + the (now controlled) `EditorPane`.
 *
 * `openInSplit` is the single "open a file" helper: it opens the split when
 * closed, opens/activates the file's tab, and records a pending line to scroll
 * to. The pane consumes the pending scroll after mounting the viewer.
 *
 * See change: split-editor-workspace.
 */

import {
  findEditorPaneTabClaim,
  useSlotClaimsVersion,
  useSlotRegistryOrNull,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FileDigest } from "../../lib/file-digest.js";
import {
  type EditorPaneAction,
  type EditorPaneState,
  useEditorPaneState,
} from "../../lib/layout/editor-pane-state.js";
import { type SplitMode, type SplitOrientation, type SplitState, useSplitState } from "../../lib/layout/split-state.js";
import { type TerminalPaneTabs, useTerminalPaneTabs } from "../../lib/layout/use-terminal-pane-tabs.js";
import { saveTreeVisible } from "../../lib/util/tree-visible.js";
import { isPseudoTabViewer } from "../editor-pane/viewer-kinds.js";
import { type TrackedFileWrite, TrackedFileWriteProvider } from "./tracked-file-write.js";
import { useChangeVerification } from "./use-change-verification.js";

export interface PendingScroll {
  path: string;
  line: number;
}

export interface SplitWorkspaceContextValue {
  sessionId: string;
  cwd: string;
  split: SplitState;
  updateSplit: (patch: Partial<SplitState>) => void;
  /** Set the content-area layout mode (header segmented switch). */
  setMode: (mode: SplitMode) => void;
  paneState: EditorPaneState;
  dispatch: React.Dispatch<EditorPaneAction>;
  /** Reveal the split ONLY from `closed`; keep the current mode (`split`/`full`)
   *  when the editor is already shown. Shared by every opener + the deep-link
   *  sync so `full` stays sticky. See change: non-disruptive-file-open. */
  ensureRevealed: () => void;
  /**
   * Open a file in the split, auto-opening the split when closed; scroll to
   * `line`. `restrictCsp` marks a canvas auto-open (no user click) so document
   * viewers inject a restrictive CSP (auto-canvas S34). `background` (agent
   * auto-open while the editor is already shown) adds the tab silently — no
   * active-tab change, no pending scroll, marked unread. `autoOpened` marks an
   * agent (canvas auto-open) as the opener — provenance, independent of both:
   * a viewer it mounts opts out of the access-grant dialog (see change:
   * surface-denial-remedy-in-previews, D4).
   */
  openInSplit: (
    relPath: string,
    line?: number,
    restrictCsp?: boolean,
    opts?: { background?: boolean; autoOpened?: boolean },
  ) => void;
  /** Open a loopback dev-server URL in the `live-server` split viewer (auto-launched). */
  openLiveTarget: (url: string, opts?: { background?: boolean }) => void;
  /** Open a generic URL/youtube target in the `url` split viewer (auto-canvas S35). */
  openUrlTarget: (url: string, opts?: { background?: boolean }) => void;
  /**
   * Open (or focus) a plugin-owned `<pathPrefix>:<rest>` tab. Returns `false`
   * (and opens nothing) when no enabled `editor-pane-tab` claim owns the
   * prefix, or the prefix is built-in. See change: add-browser-editor-pane-tab (D3).
   */
  openPluginTab: (path: string) => boolean;
  /** Open a file's diff as a `diff:<relPath>` viewer tab (coexists with its monaco tab). */
  openDiffTab: (relPath: string) => void;
  /** Open the split and reveal the Changes section in the pane rail. */
  openChanges: () => void;
  /** Bumps whenever `openChanges()` fires so the rail section expands + scrolls into view. */
  changesRevealSignal: number;
  /** Pending scroll target for the pane, or `null`. */
  pendingScroll: PendingScroll | null;
  /** Clear the pending scroll once the pane has honoured it. */
  consumePendingScroll: () => void;
  /** Latest bridge filename-walk result (shared with the composer `@` autocomplete). */
  fileResults: { query: string; files: FileEntry[] } | null;
  /** Fire a bridge filename walk for the editor search panel (Filenames mode). */
  onFilenameSearch: (query: string, regex: boolean) => void;
  /**
   * Rel-paths whose bytes really differ from the tab baseline (drives the
   * changed-on-disk banner). With change detection on this is the VERIFIED set;
   * a bare `file_changed` signal is only a candidate until its digest differs.
   * See change: gate-changed-on-disk-by-content.
   */
  changedFiles: Set<string> | null;
  /** Clear a path's changed-on-disk flag (Refresh or Dismiss). */
  clearChanged: (path: string) => void;
  /** True for the session pane: baselines, digests and own-save tracking are active. */
  changeDetection: boolean;
  /**
   * Record the tab's content baseline BEFORE its viewer mounts (resolves once
   * the digest is stored; never rejects). No-op when change detection is off.
   */
  captureBaseline: (path: string) => Promise<void>;
  /**
   * `POST /api/file/write` for an in-pane writer: rebaselines the tab from the
   * response `sha1` so the user's own Save never raises the banner. A plain
   * passthrough when change detection is off.
   */
  trackedFileWrite: TrackedFileWrite;
  /**
   * Set the tab baseline to a known digest (a file-handler snapshot). No-op
   * when change detection is off. See change: add-editor-pane-file-handlers (D3).
   */
  setBaseline: (path: string, digest: FileDigest) => void;
  /** Re-send `watch_files` for the open set (Refresh; also fired on WS reconnect). */
  resyncWatch: () => void;
  /**
   * Terminal-tab slice for the pane cwd (`term:<id>` tabs). Inert when the
   * shell wires no terminal handlers (tests, standalone surfaces).
   * See change: terminals-in-tabbed-panes.
   */
  terminal: TerminalPaneTabs;
  /**
   * Sticky activation latch (D3, change: add-lazy-terminal-diff-bootstrap).
   * `false` until a `term:` tab has been the ACTIVE tab at least once this page
   * session; latched `true` thereafter, never reset while the provider lives.
   * Provider-scoped so it survives `EditorPane` unmount (pane collapse) and NOT
   * persisted — a fresh page load starts unlatched. Gates the lazy
   * `TerminalPaneLayer` mount so xterm is not fetched on cold landing.
   */
  terminalActivated: boolean;
}

const SplitWorkspaceContext = createContext<SplitWorkspaceContextValue | null>(null);

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

/** Stable empty terminals array — avoids a new [] identity each render. */
const EMPTY_TERMINALS: TerminalSession[] = [];

interface ProviderProps {
  sessionId: string;
  cwd: string;
  /** Responsive orientation (`h` desktop / `v` stacked); mirrored into persisted state. */
  orientation: SplitOrientation;
  /** Bridge filename-walk result (from `App`); optional so tests can omit it. */
  fileResults?: { query: string; files: FileEntry[] } | null;
  /** Fire a bridge filename walk (from `App`'s `handleListFiles`). */
  onFilenameSearch?: (query: string, regex: boolean) => void;
  /**
   * Changed-on-disk CANDIDATES for this session (from `App`): path → generation,
   * bumped on every `file_changed`. See change: gate-changed-on-disk-by-content.
   */
  changedFiles?: Map<string, number> | null;
  /**
   * Session scope only: verify candidates against content baselines. Default
   * `false` (the folder pane: no digests, no baselines, no banner).
   */
  changeDetection?: boolean;
  /** WS connection generation; a bump re-declares the watch + runs a catch-up. */
  connectionGeneration?: number;
  /** Declare open files to the server watch (from `App`'s `send`). Signature
   *  takes explicit sessionId+cwd so the effect cleanup clears the OUTGOING
   *  session on a switch. */
  onWatchFiles?: (sessionId: string, cwd: string, paths: string[]) => void;
  /** Clear a path's changed flag (from `App`); with `gen`, only if still that generation. */
  onClearChanged?: (path: string, gen?: number) => void;
  /** cwd-scoped terminals from `App` (ephemeral filtered inside the pane). */
  terminals?: TerminalSession[];
  /** Folder pane auto-surfaces every cwd terminal; session split is opt-in. */
  autoSurfaceTerminals?: boolean;
  /** Layout mode when nothing is stored for `sessionId` (default `closed`; the folder home uses `split`). */
  defaultMode?: SplitMode;
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
  /** One-shot terminal-focused entry (`?focus=terminal`). See change:
   *  fix-terminals-action-opens-terminal. */
  focusOnMount?: boolean;
  /** Terminal snapshot applied — gates the one-shot. */
  terminalsReady?: boolean;
  /** Fired once the one-shot is honoured (URL param consumption). */
  onFocusConsumed?: () => void;
  children: React.ReactNode;
}

export function SplitWorkspaceProvider({
  sessionId,
  cwd,
  orientation,
  fileResults = null,
  onFilenameSearch,
  changedFiles: candidates = null,
  changeDetection: changeDetectionRequested = false,
  connectionGeneration = 0,
  onWatchFiles,
  onClearChanged,
  terminals: cwdTerminals,
  autoSurfaceTerminals = false,
  defaultMode,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
  focusOnMount,
  terminalsReady,
  onFocusConsumed,
  children,
}: ProviderProps) {
  // A session pane opened by direct URL renders before the session list hydrates,
  // so `cwd` is "" for a moment. A digest with no cwd is a guaranteed 400 -> null
  // baseline -> a false banner on the next touch; hold detection off until it lands.
  const changeDetection = changeDetectionRequested && cwd !== "";
  const [split, updateSplit] = useSplitState(sessionId, defaultMode);
  const [paneState, dispatch] = useEditorPaneState(sessionId);
  const ensurePaneOpen = useCallback(() => updateSplit({ mode: "split" }), [updateSplit]);
  const terminal = useTerminalPaneTabs({
    cwd,
    terminals: cwdTerminals ?? EMPTY_TERMINALS,
    autoSurface: autoSurfaceTerminals,
    paneState,
    dispatch,
    ensureOpen: ensurePaneOpen,
    onCreateTerminal,
    onKillTerminal,
    onRenameTerminal,
    onTerminalTitle,
    focusOnMount,
    terminalsReady,
    onFocusConsumed,
  });
  const [pendingScroll, setPendingScroll] = useState<PendingScroll | null>(null);

  // D3 sticky activation latch. Latch the first time the ACTIVE tab is a
  // terminal; never reset while the provider lives (switching to a file tab must
  // NOT unmount the keep-alive layer). Provider-scoped so a pane
  // collapse/reopen — which unmounts `EditorPane` — does not reset it. See
  // change: add-lazy-terminal-diff-bootstrap.
  const [terminalActivated, setTerminalActivated] = useState(false);
  const activeViewer = paneState.activeIndex >= 0 ? paneState.openFiles[paneState.activeIndex]?.viewer : null;
  useEffect(() => {
    if (!terminalActivated && activeViewer === "terminal") setTerminalActivated(true);
  }, [terminalActivated, activeViewer]);

  // Keep the persisted orientation in step with the responsive layout so a
  // reload on the same device restores a sensible divider axis.
  useEffect(() => {
    if (split.orientation !== orientation) updateSplit({ orientation });
  }, [orientation, split.orientation, updateSplit]);

  // Reveal the split only from `closed`; a content opener never yanks `full`
  // (or `split`) once the editor is already shown. Plain `split.mode` dep — no
  // `modeRef` (design Decision 1). See change: non-disruptive-file-open.
  const ensureRevealed = useCallback(() => {
    if (split.mode === "closed") updateSplit({ mode: "split" });
  }, [split.mode, updateSplit]);

  const openInSplit = useCallback(
    (relPath: string, line?: number, restrictCsp?: boolean, opts?: { background?: boolean; autoOpened?: boolean }) => {
      if (!relPath) return;
      const viewer = fileKind(absOf(cwd, relPath)).viewer;
      // Background only applies when the editor is already shown; from `closed`
      // there is no reading context to protect → reveal + activate.
      const background = opts?.background === true && split.mode !== "closed";
      dispatch({
        type: "openFile",
        path: relPath,
        viewer,
        restrictCsp,
        activate: !background,
        autoOpened: opts?.autoOpened === true,
      });
      ensureRevealed();
      // A background tab is not activated; a stashed scroll would jump when the
      // user later opens it — so only foreground opens set pendingScroll.
      if (!background && line && line > 0) setPendingScroll({ path: relPath, line });
    },
    [cwd, dispatch, ensureRevealed, split.mode],
  );

  const openLiveTarget = useCallback(
    (url: string, opts?: { background?: boolean }) => {
      // NOT via openInSplit — that derives the viewer from fileKind and can
      // never yield `live-server`. The `openFile` reducer is idempotent by
      // path, so the same URL reuses its tab.
      const background = opts?.background === true && split.mode !== "closed";
      dispatch({ type: "openFile", path: `live:${url}`, viewer: "live-server", activate: !background });
      ensureRevealed();
    },
    [dispatch, ensureRevealed, split.mode],
  );

  const openUrlTarget = useCallback(
    (url: string, opts?: { background?: boolean }) => {
      // Generic url/youtube canvas target — opened under a virtual `url:<url>`
      // path so the `url` split viewer (dispatchPreview → PreviewBody) renders
      // it. Idempotent by path. See change: auto-canvas (S35).
      if (!url) return;
      const background = opts?.background === true && split.mode !== "closed";
      dispatch({ type: "openFile", path: `url:${url}`, viewer: "url", activate: !background });
      ensureRevealed();
    },
    [dispatch, ensureRevealed, split.mode],
  );

  // Plugin tabs: claimed-prefix check, then the idempotent-by-path `openFile`
  // (focuses an existing tab instead of duplicating it). Not via openInSplit —
  // that derives the viewer from fileKind. See change: add-browser-editor-pane-tab (D3).
  useSlotClaimsVersion();
  const slotRegistry = useSlotRegistryOrNull();
  const openPluginTab = useCallback(
    (path: string) => {
      if (!findEditorPaneTabClaim(slotRegistry, path)) return false;
      dispatch({ type: "openFile", path, viewer: "plugin" });
      ensureRevealed();
      return true;
    },
    [slotRegistry, dispatch, ensureRevealed],
  );

  // Diff tabs open under a virtual `diff:<relPath>` path (mirrors `live:<url>`)
  // so they never collide with the monaco tab of the same real file (the
  // reducer dedups by full path). See change: add-change-summary-table.
  const openDiffTab = useCallback(
    (relPath: string) => {
      if (!relPath) return;
      dispatch({ type: "openFile", path: `diff:${relPath}`, viewer: "diff" });
      ensureRevealed();
    },
    [dispatch, ensureRevealed],
  );

  const [changesRevealSignal, setChangesRevealSignal] = useState(0);
  const openChanges = useCallback(() => {
    // Persist tree visibility BEFORE the split opens so a freshly-mounted
    // EditorPane reads it visible (the rail defaults collapsed — change:
    // collapse-files-panel-by-default — and the pane mounts AFTER this bump, so
    // an in-pane reveal effect alone would miss the first open). An
    // already-mounted pane is handled by its changesRevealSignal effect. See
    // change: detect-tool-created-files.
    saveTreeVisible(sessionId, true);
    ensureRevealed();
    setChangesRevealSignal((n) => n + 1);
  }, [sessionId, ensureRevealed]);

  const setMode = useCallback((mode: SplitMode) => updateSplit({ mode }), [updateSplit]);
  const consumePendingScroll = useCallback(() => setPendingScroll(null), []);

  const noopFilenameSearch = useCallback((_q: string, _r: boolean) => {}, []);
  const filenameSearch = onFilenameSearch ?? noopFilenameSearch;
  const noopClear = useCallback((_path: string, _gen?: number) => {}, []);
  const clearCandidate = onClearChanged ?? noopClear;

  // Server open-files watch. Held in a ref so identity churn of the inline
  // `onWatchFiles` prop does not re-run the effects. Split in two so a tab
  // open/close reconciles the set WITHOUT the redundant close+reopen churn a
  // shared-cleanup effect would cause; a session switch / unmount still clears
  // the OUTGOING session (its cleanup captures that effect's sessionId/cwd).
  // See change: split-editor-workspace.
  const watchRef = useRef(onWatchFiles);
  watchRef.current = onWatchFiles;
  // Only real files are watched: pseudo-tab and plugin paths are virtual and
  // never reach the server watcher. See change: add-browser-editor-pane-tab (D3).
  const openPathsKey = paneState.openFiles
    .filter((f) => !isPseudoTabViewer(f.viewer))
    .map((f) => f.path)
    .join("\u0000");
  const openPaths = useMemo(() => openPathsKey.split("\u0000").filter(Boolean), [openPathsKey]);
  // Bumped by Refresh and by a WS reconnect so the watch effect re-declares the
  // open set even though no tab changed (the server's watch for a key dropped
  // after a long delete is only restored this way).
  const [watchNonce, setWatchNonce] = useState(0);
  const resyncWatch = useCallback(() => setWatchNonce((n) => n + 1), []);

  const verification = useChangeVerification({
    enabled: changeDetection,
    sessionId,
    cwd,
    candidates,
    onClearCandidate: clearCandidate,
    openPaths,
    connectionGeneration,
    resyncWatch,
  });
  const { captureBaseline, trackedFileWrite, setBaseline, dismiss } = verification;
  // Banner source: verified paths (session pane) or, legacy/off, the raw candidates.
  const changedFiles = useMemo<Set<string> | null>(
    () => (changeDetection ? verification.verified : candidates ? new Set(candidates.keys()) : null),
    [changeDetection, verification.verified, candidates],
  );
  const clearChanged = useCallback(
    (path: string) => (changeDetection ? dismiss(path) : clearCandidate(path)),
    [changeDetection, dismiss, clearCandidate],
  );

  // (a) Declare the current open set (server reconciles idempotently).
  // `watchNonce` is a dependency on purpose: it forces a re-send with an
  // unchanged set. See change: gate-changed-on-disk-by-content (D5).
  // biome-ignore lint/correctness/useExhaustiveDependencies: watchNonce is a deliberate re-fire trigger
  useEffect(() => {
    if (!sessionId || !cwd) return;
    const paths = split.mode !== "closed" ? openPathsKey.split("\u0000").filter(Boolean) : [];
    watchRef.current?.(sessionId, cwd, paths);
  }, [sessionId, cwd, openPathsKey, split.mode, watchNonce]);
  // (b) Clear this session's watchers on session switch / unmount only.
  useEffect(() => {
    if (!sessionId || !cwd) return;
    return () => watchRef.current?.(sessionId, cwd, []);
  }, [sessionId, cwd]);

  const value = useMemo<SplitWorkspaceContextValue>(
    () => ({
      sessionId,
      cwd,
      split,
      updateSplit,
      setMode,
      paneState,
      dispatch,
      ensureRevealed,
      openInSplit,
      openLiveTarget,
      openUrlTarget,
      openPluginTab,
      openDiffTab,
      openChanges,
      changesRevealSignal,
      pendingScroll,
      consumePendingScroll,
      fileResults,
      onFilenameSearch: filenameSearch,
      changedFiles,
      clearChanged,
      changeDetection,
      captureBaseline,
      trackedFileWrite,
      setBaseline,
      resyncWatch,
      terminal,
      terminalActivated,
    }),
    [sessionId, cwd, split, updateSplit, setMode, paneState, dispatch, ensureRevealed, openInSplit, openLiveTarget, openUrlTarget, openPluginTab, openDiffTab, openChanges, changesRevealSignal, pendingScroll, consumePendingScroll, fileResults, filenameSearch, changedFiles, clearChanged, changeDetection, captureBaseline, trackedFileWrite, setBaseline, resyncWatch, terminal, terminalActivated],
  );

  return (
    <SplitWorkspaceContext.Provider value={value}>
      <TrackedFileWriteProvider value={trackedFileWrite}>{children}</TrackedFileWriteProvider>
    </SplitWorkspaceContext.Provider>
  );
}

/** Access split-workspace controls. Throws when used outside the provider. */
export function useSplitWorkspace(): SplitWorkspaceContextValue {
  const ctx = useContext(SplitWorkspaceContext);
  if (!ctx) throw new Error("useSplitWorkspace must be used within a SplitWorkspaceProvider");
  return ctx;
}

/** Access split-workspace controls, or `null` outside the provider (dialogs, standalone surfaces). */
export function useOptionalSplitWorkspace(): SplitWorkspaceContextValue | null {
  return useContext(SplitWorkspaceContext);
}
