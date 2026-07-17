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

import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type EditorPaneAction,
  type EditorPaneState,
  useEditorPaneState,
} from "../lib/editor-pane-state.js";
import { type SplitMode, type SplitOrientation, type SplitState, useSplitState } from "../lib/split-state.js";
import { saveTreeVisible } from "../lib/tree-visible.js";
import { type TerminalPaneTabs, useTerminalPaneTabs } from "../lib/use-terminal-pane-tabs.js";

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
   * active-tab change, no pending scroll, marked unread.
   */
  openInSplit: (relPath: string, line?: number, restrictCsp?: boolean, opts?: { background?: boolean }) => void;
  /** Open a loopback dev-server URL in the `live-server` split viewer (auto-launched). */
  openLiveTarget: (url: string, opts?: { background?: boolean }) => void;
  /** Open a generic URL/youtube target in the `url` split viewer (auto-canvas S35). */
  openUrlTarget: (url: string, opts?: { background?: boolean }) => void;
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
  /** Rel-paths that changed on disk for this session's open tabs. */
  changedFiles: Set<string> | null;
  /** Clear a path's changed-on-disk flag (Refresh or Dismiss). */
  clearChanged: (path: string) => void;
  /**
   * Terminal-tab slice for the pane cwd (`term:<id>` tabs). Inert when the
   * shell wires no terminal handlers (tests, standalone surfaces).
   * See change: terminals-in-tabbed-panes.
   */
  terminal: TerminalPaneTabs;
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
  /** Changed-on-disk rel-paths for this session (from `App`). */
  changedFiles?: Set<string> | null;
  /** Declare open files to the server watch (from `App`'s `send`). Signature
   *  takes explicit sessionId+cwd so the effect cleanup clears the OUTGOING
   *  session on a switch. */
  onWatchFiles?: (sessionId: string, cwd: string, paths: string[]) => void;
  /** Clear a path's changed flag (from `App`). */
  onClearChanged?: (path: string) => void;
  /** cwd-scoped terminals from `App` (ephemeral filtered inside the pane). */
  terminals?: TerminalSession[];
  /** Folder pane auto-surfaces every cwd terminal; session split is opt-in. */
  autoSurfaceTerminals?: boolean;
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
  children: React.ReactNode;
}

export function SplitWorkspaceProvider({
  sessionId,
  cwd,
  orientation,
  fileResults = null,
  onFilenameSearch,
  changedFiles = null,
  onWatchFiles,
  onClearChanged,
  terminals: cwdTerminals,
  autoSurfaceTerminals = false,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
  children,
}: ProviderProps) {
  const [split, updateSplit] = useSplitState(sessionId);
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
  });
  const [pendingScroll, setPendingScroll] = useState<PendingScroll | null>(null);

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
    (relPath: string, line?: number, restrictCsp?: boolean, opts?: { background?: boolean }) => {
      if (!relPath) return;
      const viewer = fileKind(absOf(cwd, relPath)).viewer;
      // Background only applies when the editor is already shown; from `closed`
      // there is no reading context to protect → reveal + activate.
      const background = opts?.background === true && split.mode !== "closed";
      dispatch({ type: "openFile", path: relPath, viewer, restrictCsp, activate: !background });
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
  const noopClear = useCallback((_path: string) => {}, []);
  const clearChanged = onClearChanged ?? noopClear;

  // Server open-files watch. Held in a ref so identity churn of the inline
  // `onWatchFiles` prop does not re-run the effects. Split in two so a tab
  // open/close reconciles the set WITHOUT the redundant close+reopen churn a
  // shared-cleanup effect would cause; a session switch / unmount still clears
  // the OUTGOING session (its cleanup captures that effect's sessionId/cwd).
  // See change: split-editor-workspace.
  const watchRef = useRef(onWatchFiles);
  watchRef.current = onWatchFiles;
  const openPathsKey = paneState.openFiles.map((f) => f.path).join("\u0000");
  // (a) Declare the current open set (server reconciles idempotently).
  useEffect(() => {
    if (!sessionId || !cwd) return;
    const paths = split.mode !== "closed" ? openPathsKey.split("\u0000").filter(Boolean) : [];
    watchRef.current?.(sessionId, cwd, paths);
  }, [sessionId, cwd, openPathsKey, split.mode]);
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
      openDiffTab,
      openChanges,
      changesRevealSignal,
      pendingScroll,
      consumePendingScroll,
      fileResults,
      onFilenameSearch: filenameSearch,
      changedFiles,
      clearChanged,
      terminal,
    }),
    [sessionId, cwd, split, updateSplit, setMode, paneState, dispatch, ensureRevealed, openInSplit, openLiveTarget, openUrlTarget, openDiffTab, openChanges, changesRevealSignal, pendingScroll, consumePendingScroll, fileResults, filenameSearch, changedFiles, clearChanged, terminal],
  );

  return <SplitWorkspaceContext.Provider value={value}>{children}</SplitWorkspaceContext.Provider>;
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
