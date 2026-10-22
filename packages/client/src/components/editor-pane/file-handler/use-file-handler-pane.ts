/**
 * Pane-side wiring of file-handler modes for the EditorPane: which claims match
 * the open tabs, whether the active tab renders a handler, the guarded actions
 * (mode switch, tab close, refresh) and the store sync effects.
 *
 * Handler modes exist only in session-scoped panes (`sessionPane`); a folder
 * pane has no session cwd for the write route and gets an inert result.
 *
 * See change: add-editor-pane-file-handlers (D2, D5, tasks 3.2/5.1/5.3).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorPaneAction, EditorPaneState, OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { isPseudoTabViewer } from "../viewer-kinds.js";
import { type CloseRiskLookups, handlerCloseRisk } from "./close-risk.js";
import { claimsForPath, type FileHandlerClaim, fileHandlerInstanceKey, isUnderSessionCwd } from "./file-handler-claims.js";
import { useFileHandlerClaims, useFileHandlerState, useFileHandlerStore } from "./use-file-handler-store.js";

export interface FileHandlerPane {
  /** Claims matching the active tab's file, in display order (empty → no switcher). */
  matching: FileHandlerClaim[];
  /** The active tab renders a handler instead of its built-in viewer. */
  handlerView: boolean;
  /** Instance key of the active handler tab, else `null`. */
  activeKey: string | null;
  /** The file is outside the session folder (modes shown unavailable). */
  outsideCwd: boolean;
  /** Select a mode (or `undefined` = built-in); guarded when it discards edits. */
  selectMode: (mode: string | undefined) => Promise<void>;
  /** Guard closing tab `index`; resolves `true` when the close may proceed. */
  guardTabClose: (index: number) => Promise<boolean>;
  /** Header / banner refresh on a handler tab: guard → `remount`. Resolves `true` when it proceeded. */
  refreshHandler: () => Promise<boolean>;
  /** Close-risk lookups for the bulk-close planner (inert, `keyOf → null`, in folder panes). */
  closeLookups: CloseRiskLookups;
  /** Drop a handler instance after the bulk summary confirmation (never mid-edit without it). */
  discardInstance: (key: string) => void;
}

interface Args {
  sessionId: string;
  cwd: string;
  /** Session-scoped pane (`changeDetection`). */
  sessionPane: boolean;
  state: EditorPaneState;
  dispatch: (a: EditorPaneAction) => void;
}

const keyOf = (sessionId: string, cwd: string, tab: OpenFile): string | null =>
  tab.handlerMode ? fileHandlerInstanceKey(sessionId, cwd, tab.path, tab.handlerMode) : null;

export function useFileHandlerPane({ sessionId, cwd, sessionPane: sessionScoped, state, dispatch }: Args): FileHandlerPane {
  // The render right after a session switch still holds the PREVIOUS session's
  // tabs (`useEditorPaneState` reloads one render later): never wire handlers
  // from it. See change: add-editor-pane-file-handlers (D5).
  const settledSession = useRef(sessionId);
  const sessionPane = sessionScoped && settledSession.current === sessionId;
  useEffect(() => {
    settledSession.current = sessionId;
  });
  const store = useFileHandlerStore();
  const claims = useFileHandlerClaims();
  const st = useFileHandlerState();
  const activeTab = state.activeIndex >= 0 ? state.openFiles[state.activeIndex] : null;
  const isFileTab = !!activeTab && !isPseudoTabViewer(activeTab.viewer);

  const matching = useMemo(
    () => (sessionPane && isFileTab && activeTab ? claimsForPath(claims, activeTab.path) : []),
    [sessionPane, isFileTab, activeTab, claims],
  );
  const outsideCwd = !!activeTab && isFileTab && !isUnderSessionCwd(activeTab.path, cwd);
  const activeClaim =
    sessionPane && isFileTab && !outsideCwd && activeTab?.handlerMode
      ? (matching.find((c) => c.key === activeTab.handlerMode) ?? null)
      : null;
  const activeKey = sessionPane && isFileTab && activeTab ? keyOf(sessionId, cwd, activeTab) : null;
  // A disabled plugin's instance holding edits stays reachable (overlay) even
  // though its claim no longer resolves.
  const orphan = !activeClaim && !!activeKey && !outsideCwd && st.instances.some((i) => i.key === activeKey && i.claimGone);
  const handlerView = !!activeClaim || orphan;
  const evicted = !!activeKey && st.evicted.has(activeKey);

  // Create / touch the instance for the active handler tab. A refused mount
  // (cap dialog cancelled) leaves the new mode unopened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `evicted` re-runs the activation after Resume
  useEffect(() => {
    if (!activeClaim || !activeTab || !activeKey) return;
    let live = true;
    void store.activate({ sessionId, cwd, path: activeTab.path, claim: activeClaim }).then((ok) => {
      if (!ok && live) dispatch({ type: "setHandlerMode", path: activeTab.path, mode: undefined });
    });
    return () => {
      live = false;
    };
  }, [store, sessionId, cwd, activeClaim, activeTab, activeKey, evicted, dispatch]);

  const visibleKey = handlerView ? activeKey : null;
  useEffect(() => {
    store.setActive(sessionId, visibleKey);
  }, [store, sessionId, visibleKey]);
  useEffect(() => () => store.paneClosed(sessionId), [store, sessionId]);

  // Drop instances whose tab is gone.
  const wanted = useMemo(() => {
    const set = new Set<string>();
    for (const tab of state.openFiles) {
      const k = keyOf(sessionId, cwd, tab);
      if (k) set.add(k);
    }
    return set;
  }, [state.openFiles, sessionId, cwd]);
  useEffect(() => {
    if (!sessionPane) return;
    store.syncTabs(sessionId, cwd, wanted);
  }, [store, sessionPane, sessionId, cwd, wanted]);

  const selectMode = useCallback(
    async (mode: string | undefined) => {
      if (!activeTab || mode === activeTab.handlerMode) return;
      if (activeKey && !(await store.guardDiscard(activeKey, "switch-mode"))) return;
      dispatch({ type: "setHandlerMode", path: activeTab.path, mode });
    },
    [store, activeTab, activeKey, dispatch],
  );

  const guardTabClose = useCallback(
    async (index: number) => {
      const tab = state.openFiles[index];
      if (!sessionPane || !tab) return true;
      const key = keyOf(sessionId, cwd, tab);
      if (!key) return true;
      // Shared / missing / clean instances need no prompt; otherwise `guardDiscard` asks.
      const remaining = state.openFiles.filter((_, i) => i !== index);
      const risk = handlerCloseRisk(
        tab,
        remaining,
        { keyOf: (t) => keyOf(sessionId, cwd, t), getInstance: (k) => store.getInstance(k) },
        { unknownIsRisky: true },
      );
      return risk === null ? true : store.guardDiscard(key, "close-tab");
    },
    [store, sessionPane, sessionId, cwd, state.openFiles],
  );

  const refreshHandler = useCallback(async () => {
    if (!activeKey) return false;
    if (!(await store.guardDiscard(activeKey, "refresh"))) return false;
    store.remount(activeKey);
    return true;
  }, [store, activeKey]);

  const closeLookups = useMemo<CloseRiskLookups>(
    () => ({
      keyOf: (tab) => (sessionPane ? keyOf(sessionId, cwd, tab) : null),
      getInstance: (k) => store.getInstance(k),
    }),
    [store, sessionPane, sessionId, cwd],
  );
  const discardInstance = useCallback((key: string) => store.discard(key), [store]);

  return { matching, handlerView, activeKey, outsideCwd, selectMode, guardTabClose, refreshHandler, closeLookups, discardInstance };
}
