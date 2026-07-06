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
import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type EditorPaneAction,
  type EditorPaneState,
  useEditorPaneState,
} from "../lib/editor-pane-state.js";
import { type SplitOrientation, type SplitState, useSplitState } from "../lib/split-state.js";

export interface PendingScroll {
  path: string;
  line: number;
}

export interface SplitWorkspaceContextValue {
  sessionId: string;
  cwd: string;
  split: SplitState;
  updateSplit: (patch: Partial<SplitState>) => void;
  toggleSplit: () => void;
  paneState: EditorPaneState;
  dispatch: React.Dispatch<EditorPaneAction>;
  /** Open a file in the split, auto-opening the split when closed; scroll to `line`. */
  openInSplit: (relPath: string, line?: number) => void;
  /** Open a loopback dev-server URL in the `live-server` split viewer (auto-launched). */
  openLiveTarget: (url: string) => void;
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
}

const SplitWorkspaceContext = createContext<SplitWorkspaceContextValue | null>(null);

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

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
  children,
}: ProviderProps) {
  const [split, updateSplit] = useSplitState(sessionId);
  const [paneState, dispatch] = useEditorPaneState(sessionId);
  const [pendingScroll, setPendingScroll] = useState<PendingScroll | null>(null);

  // Keep the persisted orientation in step with the responsive layout so a
  // reload on the same device restores a sensible divider axis.
  useEffect(() => {
    if (split.orientation !== orientation) updateSplit({ orientation });
  }, [orientation, split.orientation, updateSplit]);

  const openInSplit = useCallback(
    (relPath: string, line?: number) => {
      if (!relPath) return;
      const viewer = fileKind(absOf(cwd, relPath)).viewer;
      dispatch({ type: "openFile", path: relPath, viewer });
      updateSplit({ open: true });
      if (line && line > 0) setPendingScroll({ path: relPath, line });
    },
    [cwd, dispatch, updateSplit],
  );

  const openLiveTarget = useCallback(
    (url: string) => {
      // NOT via openInSplit — that derives the viewer from fileKind and can
      // never yield `live-server`. The `openFile` reducer is idempotent by
      // path, so the same URL reuses its tab.
      dispatch({ type: "openFile", path: `live:${url}`, viewer: "live-server" });
      updateSplit({ open: true });
    },
    [dispatch, updateSplit],
  );

  const toggleSplit = useCallback(() => updateSplit({ open: !split.open }), [split.open, updateSplit]);
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
    const paths = split.open ? openPathsKey.split("\u0000").filter(Boolean) : [];
    watchRef.current?.(sessionId, cwd, paths);
  }, [sessionId, cwd, openPathsKey, split.open]);
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
      toggleSplit,
      paneState,
      dispatch,
      openInSplit,
      openLiveTarget,
      pendingScroll,
      consumePendingScroll,
      fileResults,
      onFilenameSearch: filenameSearch,
      changedFiles,
      clearChanged,
    }),
    [sessionId, cwd, split, updateSplit, toggleSplit, paneState, dispatch, openInSplit, openLiveTarget, pendingScroll, consumePendingScroll, fileResults, filenameSearch, changedFiles, clearChanged],
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
