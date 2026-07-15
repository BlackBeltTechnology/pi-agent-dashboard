/**
 * Per-session editor-pane state with `localStorage` persistence.
 *
 * State (open tabs, active tab, expanded tree directories) persists under
 * `pi-dashboard:editor-pane:<sessionId>` so it survives page reload and
 * dashboard restart within the same browser profile. All storage access is
 * best-effort: quota errors and corrupt JSON never crash the pane — they log
 * and fall back to in-memory empty state.
 *
 * See change: add-internal-monaco-editor-pane.
 */

import type { ViewerKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { useEffect, useReducer, useRef } from "react";

export const EDITOR_PANE_KEY_PREFIX = "pi-dashboard:editor-pane:";

export interface OpenFile {
  /** Path relative to the session cwd. */
  path: string;
  viewer: ViewerKind;
  /** Insertion timestamp; informational, preserves stable ordering. */
  addedAt: number;
  /**
   * Canvas auto-open marker (no user click): document viewers inject a
   * restrictive CSP. See change: auto-canvas (Section 8 / S34).
   */
  restrictCsp?: boolean;
}

export interface EditorPaneState {
  openFiles: OpenFile[];
  /** Index into `openFiles`; `-1` when no tab is open (empty state). */
  activeIndex: number;
  /** Expanded directory rel-paths in the tree rail. */
  treeOpenRoots: string[];
}

export type EditorPaneAction =
  | { type: "openFile"; path: string; viewer: ViewerKind; restrictCsp?: boolean }
  | { type: "closeTab"; index: number }
  | { type: "setActive"; index: number }
  | { type: "toggleTreeRoot"; relPath: string }
  | { type: "reorderTabs"; from: number; to: number }
  | { type: "load"; state: EditorPaneState };

export const EMPTY_PANE_STATE: EditorPaneState = {
  openFiles: [],
  activeIndex: -1,
  treeOpenRoots: [],
};

/**
 * Ancestor directory rel-paths of a file, root→leaf. `a/b/c.ts` → `[a, a/b]`.
 * Used to auto-expand the tree so an opened/activated file's row is revealed
 * (#5). Handles both `/` and `\` separators.
 */
export function ancestorDirs(relPath: string): string[] {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
}

/** Merge new dir rel-paths into the open-roots set, preserving order, deduped. */
function mergeRoots(existing: string[], add: string[]): string[] {
  const merged = [...existing];
  for (const dir of add) if (!merged.includes(dir)) merged.push(dir);
  return merged;
}

/** Pure reducer — the single mutation point for pane state. */
export function editorPaneReducer(state: EditorPaneState, action: EditorPaneAction): EditorPaneState {
  switch (action.type) {
    case "load":
      return action.state;

    case "openFile": {
      // Reveal the file's row: expand its ancestor dir chain (#5).
      const treeOpenRoots = mergeRoots(state.treeOpenRoots, ancestorDirs(action.path));
      const existing = state.openFiles.findIndex((f) => f.path === action.path);
      if (existing >= 0) {
        // Idempotent: activate the existing tab, never duplicate.
        return { ...state, activeIndex: existing, treeOpenRoots };
      }
      const openFiles = [...state.openFiles, { path: action.path, viewer: action.viewer, addedAt: Date.now(), restrictCsp: action.restrictCsp }];
      return { ...state, openFiles, activeIndex: openFiles.length - 1, treeOpenRoots };
    }

    case "closeTab": {
      if (action.index < 0 || action.index >= state.openFiles.length) return state;
      const openFiles = state.openFiles.filter((_, i) => i !== action.index);
      let activeIndex: number;
      if (openFiles.length === 0) {
        activeIndex = -1;
      } else if (action.index < state.activeIndex) {
        // A tab before the active one closed — shift the active pointer left.
        activeIndex = state.activeIndex - 1;
      } else if (action.index === state.activeIndex) {
        // Active tab closed — activate the adjacent tab (next, or last).
        activeIndex = Math.min(state.activeIndex, openFiles.length - 1);
      } else {
        activeIndex = state.activeIndex;
      }
      return { ...state, openFiles, activeIndex };
    }

    case "setActive": {
      if (action.index < 0 || action.index >= state.openFiles.length) return state;
      // Reveal the newly-active tab's row: expand its ancestor dir chain (#5).
      const treeOpenRoots = mergeRoots(state.treeOpenRoots, ancestorDirs(state.openFiles[action.index].path));
      return { ...state, activeIndex: action.index, treeOpenRoots };
    }

    case "toggleTreeRoot": {
      const has = state.treeOpenRoots.includes(action.relPath);
      const treeOpenRoots = has
        ? state.treeOpenRoots.filter((p) => p !== action.relPath)
        : [...state.treeOpenRoots, action.relPath];
      return { ...state, treeOpenRoots };
    }

    case "reorderTabs": {
      const { from, to } = action;
      const n = state.openFiles.length;
      if (from < 0 || from >= n || to < 0 || to >= n || from === to) return state;
      const activePath = state.openFiles[state.activeIndex]?.path;
      const openFiles = [...state.openFiles];
      const [moved] = openFiles.splice(from, 1);
      openFiles.splice(to, 0, moved);
      const activeIndex = activePath ? openFiles.findIndex((f) => f.path === activePath) : state.activeIndex;
      return { ...state, openFiles, activeIndex };
    }

    default:
      return state;
  }
}

function keyFor(sessionId: string): string {
  return EDITOR_PANE_KEY_PREFIX + sessionId;
}

const VALID_VIEWERS: ReadonlySet<string> = new Set([
  "monaco", "image", "pdf", "markdown", "html", "mermaid", "video", "audio", "live-server", "url", "diff", "binary-warn",
]);

/** True only for well-formed persisted state; rejects corrupt/partial blobs. */
function isValidState(v: unknown): v is EditorPaneState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (
    !Array.isArray(s.openFiles) ||
    !Number.isInteger(s.activeIndex) ||
    !Array.isArray(s.treeOpenRoots) ||
    !s.treeOpenRoots.every((r) => typeof r === "string")
  ) {
    return false;
  }
  const filesOk = s.openFiles.every((f) => {
    if (!f || typeof f !== "object") return false;
    const file = f as OpenFile;
    return typeof file.path === "string" && VALID_VIEWERS.has(file.viewer);
  });
  if (!filesOk) return false;
  // activeIndex must address an open tab, or be -1 only when no tabs are open.
  const ai = s.activeIndex as number;
  if (s.openFiles.length === 0) return ai === -1;
  return ai >= 0 && ai < s.openFiles.length;
}

/** Read persisted state for a session; empty state on absence/corruption. */
export function loadEditorPaneState(sessionId: string): EditorPaneState {
  if (!sessionId) return EMPTY_PANE_STATE;
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(sessionId));
    if (!raw) return EMPTY_PANE_STATE;
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed)) {
      console.error(`[editor-pane] discarding corrupt state for session ${sessionId}`);
      return EMPTY_PANE_STATE;
    }
    return parsed;
  } catch (err) {
    console.error(`[editor-pane] failed to read state for session ${sessionId}`, err);
    return EMPTY_PANE_STATE;
  }
}

/** Persist state; silently drops the write on quota/disabled storage. */
export function saveEditorPaneState(sessionId: string, state: EditorPaneState): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.setItem(keyFor(sessionId), JSON.stringify(state));
  } catch (err) {
    console.warn(`[editor-pane] failed to persist state for session ${sessionId}`, err);
  }
}

/**
 * Session-scoped pane state. Loads from `localStorage` on mount and on
 * `sessionId` change; persists on every state change.
 */
export function useEditorPaneState(
  sessionId: string,
): [EditorPaneState, React.Dispatch<EditorPaneAction>] {
  const [state, dispatch] = useReducer(editorPaneReducer, sessionId, loadEditorPaneState);
  const prevSession = useRef(sessionId);

  useEffect(() => {
    if (prevSession.current !== sessionId) {
      // Session switched — load that session's distinct state, skip saving the
      // outgoing state under the new key.
      prevSession.current = sessionId;
      dispatch({ type: "load", state: loadEditorPaneState(sessionId) });
      return;
    }
    saveEditorPaneState(sessionId, state);
  }, [sessionId, state]);

  return [state, dispatch];
}
