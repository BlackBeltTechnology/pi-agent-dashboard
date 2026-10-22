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
import { OPEN_PATH_VIEWERS, PSEUDO_TAB_VIEWERS } from "../../components/editor-pane/viewer-kinds.js";

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
  /**
   * Tab was added/re-signalled in the background (agent auto-open while the
   * editor was already shown) and has not been activated since. The tab strip
   * renders an unread dot. INVARIANT: the active tab is never unread — cleared
   * on any activation (setActive, closeTab re-point). See change:
   * non-disruptive-file-open.
   */
  unread?: boolean;
  /**
   * An agent (canvas auto-open), not the operator, made this tab active last.
   * A viewer mounted for an auto-opened tab opts out of the access-grant dialog.
   * Decided by the action that activates the tab (design D4 tab rules);
   * persisted; seeded from `restrictCsp` for tabs saved before the field
   * existed. See change: surface-denial-remedy-in-previews.
   */
  autoOpened?: boolean;
  /**
   * Selected plugin file-handler mode, `"<pluginId>/<claimId>"`; `undefined` =
   * the built-in view. Resolved at render (NOT validated at load: the slot
   * registry may not be ready), so a missing/disabled claim falls back to the
   * built-in view for this tab only. See change: add-editor-pane-file-handlers (D2).
   */
  handlerMode?: string;
  /**
   * Agent re-declared the tab's target with a higher version while the tab was
   * NOT active: a mounted live viewer reloads (re-mints) when this changes.
   * See change: improve-canvas-html-and-url-ux (D8).
   */
  reloadNonce?: number;
  /**
   * Agent re-declared the target of the ACTIVE tab: the viewer keeps its content
   * and offers "Updated by the agent · Reload". Cleared by `ackUpdate`.
   */
  updatedByAgent?: boolean;
}

export interface EditorPaneState {
  openFiles: OpenFile[];
  /** Index into `openFiles`; `-1` when no tab is open (empty state). */
  activeIndex: number;
  /** Expanded directory rel-paths in the tree rail. */
  treeOpenRoots: string[];
}

export type EditorPaneAction =
  | {
      type: "openFile";
      path: string;
      viewer: ViewerKind;
      restrictCsp?: boolean;
      /**
       * Focus intent. `true` (default) activates the opened tab (user click).
       * `false` adds/re-signals the tab in the background without moving
       * `activeIndex`, marking it `unread`. See change: non-disruptive-file-open.
       */
      activate?: boolean;
      /** An agent (canvas auto-open) issued this open, not the operator. */
      autoOpened?: boolean;
      /**
       * The canvas re-declared an already-open target at a higher version: an
       * inactive tab reloads (`reloadNonce`), the active tab only flags
       * `updatedByAgent`. Ignored for a tab that is not open yet.
       */
      bump?: boolean;
    }
  | { type: "closeTab"; index: number }
  // The viewer showed/handled the "Updated by the agent" notice. Clears `updatedByAgent`.
  | { type: "ackUpdate"; path: string }
  // Close the tab addressed by its full path (stable across index shifts).
  // Used by the terminal-tab reconcile loop, which drops several stale
  // `term:<id>` tabs in one pass. See change: terminals-in-tabbed-panes.
  | { type: "closeByPath"; path: string }
  | { type: "setActive"; index: number }
  | { type: "toggleTreeRoot"; relPath: string }
  // Expand-only (never collapses) merge of dir rel-paths into the open roots.
  // See change: scope-anchor-editor-pane-controls (D11).
  | { type: "expandTreeRoots"; relPaths: string[] }
  // Close several tabs in ONE dispatch, keyed by path (stable across the async
  // bulk-close dialog). See change: scope-anchor-editor-pane-controls (D5).
  | { type: "closeTabs"; paths: string[] }
  | { type: "reorderTabs"; from: number; to: number }
  // Select (or clear, `mode: undefined`) a plugin file-handler mode on the tab
  // at `path`. See change: add-editor-pane-file-handlers (D2).
  | { type: "setHandlerMode"; path: string; mode: string | undefined }
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

/**
 * Clear `unread` on the tab at `index` (active-tab-never-unread invariant).
 * Returns a NEW array so the tab strip re-renders the cleared dot; returns the
 * SAME array (no churn) when the tab is absent or already read.
 */
function clearUnreadAt(openFiles: OpenFile[], index: number): OpenFile[] {
  if (index < 0 || index >= openFiles.length || !openFiles[index].unread) return openFiles;
  const next = [...openFiles];
  next[index] = { ...next[index], unread: false };
  return next;
}

/**
 * Mark the tab at `index` unread (background add / re-signal). Always returns a
 * NEW array AND a new tab object so the tab strip's per-tab pulse effect re-runs
 * on a repeat background open of an already-unread tab (re-pulse).
 */
function setUnreadAt(openFiles: OpenFile[], index: number): OpenFile[] {
  const next = [...openFiles];
  next[index] = { ...next[index], unread: true };
  return next;
}

/**
 * Activate the tab at `index`: clear `unread` and set its provenance. Returns
 * the SAME array when nothing changes (no churn).
 */
function activateAt(openFiles: OpenFile[], index: number, autoOpened: boolean): OpenFile[] {
  const cleared = clearUnreadAt(openFiles, index);
  if (index < 0 || index >= cleared.length || (cleared[index].autoOpened ?? false) === autoOpened) return cleared;
  const next = cleared === openFiles ? [...openFiles] : cleared;
  next[index] = { ...next[index], autoOpened };
  return next;
}

/**
 * `openFile` reducer case — extracted so the switch stays under the cognitive
 * complexity budget. Handles the focus-intent matrix: foreground (default)
 * activates + clears unread; background (`activate:false`) adds/re-signals a tab
 * without moving `activeIndex`. See change: non-disruptive-file-open.
 */
function reduceOpenFile(state: EditorPaneState, action: Extract<EditorPaneAction, { type: "openFile" }>): EditorPaneState {
  const next = reduceOpenFileBase(state, action);
  if (!action.bump) return next;
  const i = next.openFiles.findIndex((f) => f.path === action.path);
  const was = state.openFiles.findIndex((f) => f.path === action.path);
  if (i < 0 || was < 0) return next; // a brand-new tab has nothing to reload
  const openFiles = [...next.openFiles];
  // The tab that WAS active keeps its content and offers a reload; any other tab reloads.
  openFiles[i] =
    was === state.activeIndex
      ? { ...openFiles[i], updatedByAgent: true }
      : { ...openFiles[i], reloadNonce: (openFiles[i].reloadNonce ?? 0) + 1 };
  return { ...next, openFiles };
}

function reduceOpenFileBase(state: EditorPaneState, action: Extract<EditorPaneAction, { type: "openFile" }>): EditorPaneState {
  // Reveal the file's row: expand its ancestor dir chain (#5).
  const treeOpenRoots = mergeRoots(state.treeOpenRoots, ancestorDirs(action.path));
  const activate = action.activate !== false; // default true (foreground)
  const autoOpened = action.autoOpened === true;
  const existing = state.openFiles.findIndex((f) => f.path === action.path);
  if (existing >= 0) {
    // Foreground: activate the existing tab + clear its unread (invariant).
    // Provenance (design D4): an auto-open of the ALREADY-active tab mounts
    // nothing, so it changes nothing; any other activation stamps who did it —
    // otherwise an agent could re-focus an operator-opened file and raise a
    // dialog through the remount.
    if (activate) {
      const openFiles =
        autoOpened && existing === state.activeIndex
          ? clearUnreadAt(state.openFiles, existing)
          : activateAt(state.openFiles, existing, autoOpened);
      return { ...state, openFiles, activeIndex: existing, treeOpenRoots };
    }
    // Background on the ACTIVE tab → no-op (active tab is never unread).
    if (existing === state.activeIndex) return { ...state, treeOpenRoots };
    // Background on an inactive open tab → re-signal unread, keep active.
    return { ...state, openFiles: setUnreadAt(state.openFiles, existing), treeOpenRoots };
  }
  const tab: OpenFile = {
    path: action.path,
    viewer: action.viewer,
    addedAt: Date.now(),
    restrictCsp: action.restrictCsp,
    autoOpened,
  };
  // Background new tab → push unread, keep the current active tab.
  if (!activate) return { ...state, openFiles: [...state.openFiles, { ...tab, unread: true }], activeIndex: state.activeIndex, treeOpenRoots };
  const openFiles = [...state.openFiles, tab];
  return { ...state, openFiles, activeIndex: openFiles.length - 1, treeOpenRoots };
}

/**
 * `closeTab` reducer case — extracted to keep the switch under the cognitive
 * complexity budget. Removes the tab and re-points `activeIndex`, then enforces
 * the active-tab-never-unread invariant on the tab it lands on.
 */
function reduceCloseTab(state: EditorPaneState, index: number, byOperator: boolean): EditorPaneState {
  if (index < 0 || index >= state.openFiles.length) return state;
  const openFiles = state.openFiles.filter((_, i) => i !== index);
  let activeIndex: number;
  if (openFiles.length === 0) {
    activeIndex = -1;
  } else if (index < state.activeIndex) {
    // A tab before the active one closed — shift the active pointer left.
    activeIndex = state.activeIndex - 1;
  } else if (index === state.activeIndex) {
    // Active tab closed — activate the adjacent tab (next, or last).
    activeIndex = Math.min(state.activeIndex, openFiles.length - 1);
  } else {
    activeIndex = state.activeIndex;
  }
  // Invariant: whatever tab activeIndex now lands on must not be unread. An
  // OPERATOR close that moves activation onto another tab makes that tab
  // operator-activated; the terminal reconcile (`closeByPath`) is not an
  // operator action and leaves provenance alone (design D4).
  const reactivated = byOperator && index === state.activeIndex;
  return {
    ...state,
    openFiles: reactivated ? activateAt(openFiles, activeIndex, false) : clearUnreadAt(openFiles, activeIndex),
    activeIndex,
  };
}

/**
 * `closeTabs` reducer case (design D5). The active tab stays active when it
 * survives; otherwise the nearest survivor right of the old active index, else
 * left, else empty. Unknown paths are ignored (state returned by identity).
 * An operator close that moves activation applies the same provenance and
 * unread rules as `reduceCloseTab`.
 */
function reduceCloseTabs(state: EditorPaneState, paths: string[]): EditorPaneState {
  const doomed = new Set(paths);
  if (!state.openFiles.some((f) => doomed.has(f.path))) return state;
  const openFiles = state.openFiles.filter((f) => !doomed.has(f.path));
  if (openFiles.length === 0) return { ...state, openFiles, activeIndex: -1 };
  const active = state.openFiles[state.activeIndex];
  if (active && !doomed.has(active.path)) {
    const activeIndex = openFiles.indexOf(active);
    return { ...state, openFiles: clearUnreadAt(openFiles, activeIndex), activeIndex };
  }
  // Active tab closed: nearest survivor to the right in the ORIGINAL order, else left.
  let survivor: OpenFile | undefined;
  for (let i = state.activeIndex + 1; i < state.openFiles.length && !survivor; i++) {
    if (!doomed.has(state.openFiles[i].path)) survivor = state.openFiles[i];
  }
  for (let i = Math.min(state.activeIndex, state.openFiles.length) - 1; i >= 0 && !survivor; i--) {
    if (!doomed.has(state.openFiles[i].path)) survivor = state.openFiles[i];
  }
  const activeIndex = survivor ? openFiles.indexOf(survivor) : 0;
  return { ...state, openFiles: activateAt(openFiles, activeIndex, false), activeIndex };
}

/** Pure reducer — the single mutation point for pane state. */
export function editorPaneReducer(state: EditorPaneState, action: EditorPaneAction): EditorPaneState {
  switch (action.type) {
    case "load":
      return action.state;

    case "openFile":
      return reduceOpenFile(state, action);

    case "ackUpdate": {
      const i = state.openFiles.findIndex((f) => f.path === action.path);
      if (i < 0 || !state.openFiles[i].updatedByAgent) return state;
      const openFiles = [...state.openFiles];
      openFiles[i] = { ...openFiles[i], updatedByAgent: false };
      return { ...state, openFiles };
    }

    case "closeByPath": {
      const index = state.openFiles.findIndex((f) => f.path === action.path);
      if (index < 0) return state;
      return reduceCloseTab(state, index, false);
    }

    case "closeTab":
      return reduceCloseTab(state, action.index, true);

    case "setActive": {
      if (action.index < 0 || action.index >= state.openFiles.length) return state;
      // Reveal the newly-active tab's row: expand its ancestor dir chain (#5).
      const treeOpenRoots = mergeRoots(state.treeOpenRoots, ancestorDirs(state.openFiles[action.index].path));
      // Invariant: the newly-active tab is never unread. A tab click is an
      // operator action: the tab becomes operator-activated (design D4).
      return { ...state, openFiles: activateAt(state.openFiles, action.index, false), activeIndex: action.index, treeOpenRoots };
    }

    case "toggleTreeRoot": {
      const has = state.treeOpenRoots.includes(action.relPath);
      const treeOpenRoots = has
        ? state.treeOpenRoots.filter((p) => p !== action.relPath)
        : [...state.treeOpenRoots, action.relPath];
      return { ...state, treeOpenRoots };
    }

    case "expandTreeRoots": {
      const treeOpenRoots = mergeRoots(state.treeOpenRoots, action.relPaths);
      return treeOpenRoots.length === state.treeOpenRoots.length ? state : { ...state, treeOpenRoots };
    }

    case "closeTabs":
      return reduceCloseTabs(state, action.paths);

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

    case "setHandlerMode": {
      const i = state.openFiles.findIndex((f) => f.path === action.path);
      if (i < 0 || state.openFiles[i].handlerMode === action.mode) return state;
      const openFiles = [...state.openFiles];
      const { handlerMode: _drop, ...rest } = openFiles[i];
      openFiles[i] = action.mode === undefined ? rest : { ...rest, handlerMode: action.mode };
      return { ...state, openFiles };
    }

    default:
      return state;
  }
}

function keyFor(sessionId: string): string {
  return EDITOR_PANE_KEY_PREFIX + sessionId;
}

/**
 * Derived from the viewer partition, so a new `ViewerKind` can never be
 * silently missing (the hand-kept set lacked six kinds and wiped any pane
 * holding one). See change: add-browser-editor-pane-tab (D2).
 */
const VALID_VIEWERS: ReadonlySet<string> = new Set<string>([...OPEN_PATH_VIEWERS, ...PSEUDO_TAB_VIEWERS]);

/**
 * Drop only entries whose `viewer` is unknown (stale kind from a reverted or
 * removed feature), re-deriving `activeIndex`: the same tab when it survived,
 * else clamped. Runs BEFORE `isValidState`, which stays all-or-nothing for
 * every structural check. See change: add-browser-editor-pane-tab (D2).
 */
function dropUnknownViewers(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const s = v as Record<string, unknown>;
  if (!Array.isArray(s.openFiles) || !Number.isInteger(s.activeIndex)) return v;
  const known = (f: unknown) =>
    !f || typeof f !== "object" || VALID_VIEWERS.has((f as { viewer?: unknown }).viewer as string);
  if (s.openFiles.every(known)) return v;
  const ai = s.activeIndex as number;
  const active = s.openFiles[ai];
  const openFiles = s.openFiles.filter(known);
  let activeIndex = openFiles.indexOf(active);
  if (activeIndex < 0) activeIndex = openFiles.length === 0 ? -1 : Math.min(Math.max(ai, 0), openFiles.length - 1);
  return { ...s, openFiles, activeIndex };
}

/**
 * Drop a malformed (non-string) `handlerMode` from the tab that carries it, so
 * one corrupt field never discards the whole blob (`isValidState` is
 * all-or-nothing). Runs BEFORE `isValidState`. See change: add-editor-pane-file-handlers (D2).
 */
function dropInvalidHandlerModes(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const s = v as Record<string, unknown>;
  if (!Array.isArray(s.openFiles)) return v;
  const bad = (f: unknown) =>
    !!f && typeof f === "object" && "handlerMode" in f && typeof (f as { handlerMode?: unknown }).handlerMode !== "string";
  if (!s.openFiles.some(bad)) return v;
  return {
    ...s,
    openFiles: s.openFiles.map((f) => {
      if (!bad(f)) return f;
      const { handlerMode: _drop, ...rest } = f as Record<string, unknown>;
      return rest;
    }),
  };
}

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
    // Optional `unread`: absent in blobs written before non-disruptive-file-open
    // (stay valid); a corrupt non-boolean (e.g. `unread: 42`) is rejected so it
    // never renders as a stray dot.
    const unreadOk = file.unread === undefined || typeof file.unread === "boolean";
    // Same rule for `autoOpened` (surface-denial-remedy-in-previews).
    const autoOk = file.autoOpened === undefined || typeof file.autoOpened === "boolean";
    // Explicit `typeof` check (change: add-editor-pane-file-handlers D2).
    const modeOk = file.handlerMode === undefined || typeof file.handlerMode === "string";
    return typeof file.path === "string" && VALID_VIEWERS.has(file.viewer) && unreadOk && autoOk && modeOk;
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
    const parsed = dropInvalidHandlerModes(dropUnknownViewers(JSON.parse(raw)));
    if (!isValidState(parsed)) {
      console.error(`[editor-pane] discarding corrupt state for session ${sessionId}`);
      return EMPTY_PANE_STATE;
    }
    // Tabs saved before `autoOpened` existed are seeded from `restrictCsp`,
    // erring closed: a canvas auto-open (and a pre-change mobile chip tap) set
    // it, so such a tab loads opted out once (design D4).
    return {
      ...parsed,
      openFiles: parsed.openFiles.map((f) => (f.autoOpened === undefined ? { ...f, autoOpened: f.restrictCsp === true } : f)),
    };
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
