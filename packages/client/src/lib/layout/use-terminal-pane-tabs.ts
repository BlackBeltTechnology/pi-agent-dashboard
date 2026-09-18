/**
 * Terminal-tab slice for an editor pane. Hosts terminals as virtual
 * `term:<id>` tabs (viewer kind `terminal`) alongside file/diff/live tabs,
 * reusing the pane's tab reducer.
 *
 * Three behaviours, all keyed off the pane's cwd-scoped, non-ephemeral
 * terminal set:
 *   - D5 reconcile: on every terminal-set change (and mount), drop any open
 *     `term:<id>` tab whose id is no longer live — so a persisted tab pointing
 *     at a dead PTY does not linger after a restart.
 *   - D3 auto-surface (folder pane, `autoSurface`): open a tab for every live
 *     terminal, so the folder pane is the "see all my terminals" surface.
 *   - D3 opt-in (session split): a terminal becomes a tab only on explicit
 *     `createTerminal()` (open the newly-created one) or `openTerminal(id)`.
 *
 * Pure helpers `stripTermId`/`reconcileTerminalTabs` are unit-tested.
 *
 * See change: terminals-in-tabbed-panes.
 */

import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorPaneAction, EditorPaneState, OpenFile } from "./editor-pane-state.js";

const TERM_TAB_PREFIX = "term:";

/** `term:<id>` → `<id>`; `null` for any non-terminal path. */
export function stripTermId(path: string): string | null {
  return path.startsWith(TERM_TAB_PREFIX) ? path.slice(TERM_TAB_PREFIX.length) : null;
}

/** Open `term:<id>` tab paths currently in the pane. */
export function openTerminalIds(openFiles: OpenFile[]): string[] {
  return openFiles
    .filter((f) => f.viewer === "terminal")
    .map((f) => stripTermId(f.path))
    .filter((id): id is string => id !== null);
}

export interface ReconcilePlan {
  /** `term:<id>` tab paths to close (id no longer live). */
  closePaths: string[];
  /** Terminal ids to open a tab for (auto-surface). */
  openIds: string[];
}

/**
 * Pure planner: given the open tabs and the live terminal id set, decide which
 * stale `term:` tabs to drop and (when `autoSurface`) which live terminals need
 * a tab. Never touches non-terminal tabs.
 *
 * Cold-load guard: an EMPTY live set is treated as "not yet known" (the WS
 * terminal snapshot has not arrived), so NO `term:` tab is dropped — otherwise
 * a page reload would wipe every persisted terminal tab before the snapshot
 * lands (the folder pane self-heals via auto-surface, but the opt-in session
 * split would lose them permanently). A later non-empty set drives the precise
 * drop. Trade-off: when a cwd's terminals are all killed externally the dead
 * tabs linger (disconnected) until the set is non-empty again or the user
 * closes them — rare, self-correcting, and never data-losing.
 */
export function reconcileTerminalTabs(
  openFiles: OpenFile[],
  liveIds: ReadonlySet<string>,
  autoSurface: boolean,
): ReconcilePlan {
  const closePaths: string[] = [];
  const open = new Set<string>();
  const known = liveIds.size > 0;
  for (const f of openFiles) {
    const id = stripTermId(f.path);
    if (id === null || f.viewer !== "terminal") continue;
    if (liveIds.has(id)) open.add(id);
    else if (known) closePaths.push(f.path);
  }
  const openIds = autoSurface ? [...liveIds].filter((id) => !open.has(id)) : [];
  return { closePaths, openIds };
}

export interface TerminalPaneTabs {
  /** Non-ephemeral terminals scoped to the pane cwd. */
  terminals: TerminalSession[];
  /** Create a terminal at the pane cwd and open its tab (session split). */
  createTerminal: () => void;
  /** Open (or activate) an existing terminal's tab. */
  openTerminal: (id: string) => void;
  /** Kill a terminal (its tab is dropped by reconcile). */
  killTerminal: (id: string) => void;
  /** Close a terminal tab AND kill its terminal (D4 — tab close == kill). */
  closeTerminalTab: (id: string) => void;
  /** Rename a terminal (persisted title). */
  renameTerminal: (id: string, title: string) => void;
  /** Auto-title from the PTY (xterm OSC title). */
  onTerminalTitle: (id: string, title: string) => void;
}

interface Options {
  cwd: string;
  /** cwd-scoped terminals from the shell (may include ephemeral; filtered here). */
  terminals: TerminalSession[];
  /** Folder pane auto-surfaces all cwd terminals; session split is opt-in. */
  autoSurface: boolean;
  paneState: EditorPaneState;
  dispatch: React.Dispatch<EditorPaneAction>;
  /** Force the pane open on create/open (session split). */
  ensureOpen: () => void;
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (id: string) => void;
  onRenameTerminal?: (id: string, title: string) => void;
  onTerminalTitle?: (id: string, title: string) => void;
  /**
   * One-shot terminal-focused entry (folder pane `?focus=terminal`): once the
   * terminal set is known, activate the newest non-ephemeral terminal or create
   * one. See change: fix-terminals-action-opens-terminal (D2).
   */
  focusOnMount?: boolean;
  /** Terminal snapshot applied (`snapshotGeneration > 0`) — gates the one-shot. */
  terminalsReady?: boolean;
  /** Fired once when the one-shot is honoured (URL param consumption, D3). */
  onFocusConsumed?: () => void;
}

export function useTerminalPaneTabs({
  cwd,
  terminals,
  autoSurface,
  paneState,
  dispatch,
  ensureOpen,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
  focusOnMount,
  terminalsReady,
  onFocusConsumed,
}: Options): TerminalPaneTabs {
  // Ephemeral terminals back inline `!!` chat cards; never tab them.
  const paneTerminals = useMemo(() => terminals.filter((t) => !t.ephemeral), [terminals]);
  // Signature over the live id SET — the only thing reconcile/auto-surface
  // depends on. Stable across the fresh-array identity the shell hands us each
  // render, so the effect fires only on a real membership change.
  const idSig = paneTerminals.map((t) => t.id).join("\u0000");

  const paneStateRef = useRef(paneState);
  paneStateRef.current = paneState;
  const knownIdsRef = useRef<Set<string>>(new Set());
  const pendingCreateRef = useRef(false);
  // Latest pane terminals for the one-shot effect — read via ref so the effect
  // can depend on `idSig` (the id set) rather than the array identity, which
  // changes on every title update.
  const paneTerminalsRef = useRef(paneTerminals);
  paneTerminalsRef.current = paneTerminals;
  // One-shot guard for the terminal-focused entry (D2).
  const focusHandledRef = useRef(false);
  // Previous cwd for the reset guard (see the reset effect below).
  const prevCwdRef = useRef(cwd);

  const openTerminal = useCallback(
    (id: string) => {
      if (!id) return;
      dispatch({ type: "openFile", path: `${TERM_TAB_PREFIX}${id}`, viewer: "terminal" });
      ensureOpen();
    },
    [dispatch, ensureOpen],
  );

  // Reconcile stale tabs + (folder) auto-surface + (split) open-newly-created.
  // `idSig` (the live id set joined by NUL) is the intended trigger AND the
  // source of `live`, so it is a genuine dependency; `paneState` is read via
  // ref so an unrelated file-tab open/close does not re-fire this effect.
  useEffect(() => {
    const live = new Set(idSig ? idSig.split("\u0000") : []);
    const { closePaths, openIds } = reconcileTerminalTabs(paneStateRef.current.openFiles, live, autoSurface);
    for (const path of closePaths) dispatch({ type: "closeByPath", path });
    for (const id of openIds) dispatch({ type: "openFile", path: `${TERM_TAB_PREFIX}${id}`, viewer: "terminal" });
    // Session split: open the freshly-created terminal (a live id we had not
    // seen before and is not already tabbed) exactly once per create.
    if (!autoSurface && pendingCreateRef.current) {
      const open = new Set(openTerminalIds(paneStateRef.current.openFiles));
      const created = [...live].find((id) => !knownIdsRef.current.has(id) && !open.has(id));
      if (created) {
        dispatch({ type: "openFile", path: `${TERM_TAB_PREFIX}${created}`, viewer: "terminal" });
        ensureOpen();
        pendingCreateRef.current = false;
      }
    }
    knownIdsRef.current = live;
  }, [idSig, autoSurface, dispatch, ensureOpen]);

  const createTerminal = useCallback(() => {
    if (!onCreateTerminal) return;
    pendingCreateRef.current = true;
    onCreateTerminal(cwd);
    ensureOpen();
  }, [onCreateTerminal, cwd, ensureOpen]);

  // (D3 corollary) `focusHandledRef` is instance-scoped, but `/folder/A` →
  // `/folder/B` changes the `cwd` prop without remounting. Reset ONLY on an
  // actual cwd change — a guardless `focusHandledRef.current = false` would
  // un-burn the flag when the effect re-runs without a cwd change (React
  // StrictMode's dev double-invoke), re-firing the one-shot and creating a
  // second PTY. Declared BEFORE the one-shot effect so the reset runs first in
  // the same commit.
  useEffect(() => {
    if (prevCwdRef.current !== cwd) {
      prevCwdRef.current = cwd;
      focusHandledRef.current = false;
    }
  }, [cwd]);

  // (D2) One-shot terminal-focused entry. Declared AFTER the reconcile effect
  // (D2b) so its activation lands after auto-surface's and wins `activeIndex`.
  // Depends on `idSig` (the live id set), NOT the `terminals` array identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `idSig`/`cwd` are intentional re-fire triggers; the terminal list is read via `paneTerminalsRef` to avoid array-identity re-runs
  useEffect(() => {
    if (!focusOnMount || !terminalsReady || focusHandledRef.current) return;
    const list = paneTerminalsRef.current;
    // Newest by `createdAt`; last element wins a tie (design D2).
    const newest = list.length ? list.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a)) : null;
    if (newest) {
      focusHandledRef.current = true;
      openTerminal(newest.id);
      onFocusConsumed?.();
    } else if (onCreateTerminal) {
      // Burn the flag synchronously so the async create cannot re-fire it.
      focusHandledRef.current = true;
      createTerminal();
      onFocusConsumed?.();
    }
    // No `onCreateTerminal` → this branch is skipped and the flag is left
    // unburned, so a later render WITH the handler still honours the entry (X1).
  }, [idSig, cwd, focusOnMount, terminalsReady, openTerminal, createTerminal, onCreateTerminal, onFocusConsumed]);

  const killTerminal = useCallback((id: string) => onKillTerminal?.(id), [onKillTerminal]);

  const closeTerminalTab = useCallback(
    (id: string) => {
      dispatch({ type: "closeByPath", path: `${TERM_TAB_PREFIX}${id}` });
      onKillTerminal?.(id);
    },
    [dispatch, onKillTerminal],
  );

  const renameTerminal = useCallback(
    (id: string, title: string) => onRenameTerminal?.(id, title),
    [onRenameTerminal],
  );

  const handleTitle = useCallback(
    (id: string, title: string) => onTerminalTitle?.(id, title),
    [onTerminalTitle],
  );

  return {
    terminals: paneTerminals,
    createTerminal,
    openTerminal,
    killTerminal,
    closeTerminalTab,
    renameTerminal,
    onTerminalTitle: handleTitle,
  };
}
