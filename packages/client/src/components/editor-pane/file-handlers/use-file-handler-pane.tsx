/**
 * `EditorPane` ↔ file-handler layer glue, kept out of `EditorPane.tsx`: resolves
 * the active tab's claims + selected mode, registers the pane (anchor + active
 * instance key) with the page-level store, activates the instance, and exposes the
 * guarded actions (mode switch, tab close, refresh).
 *
 * Session panes only (`enabled`); a folder pane has no session cwd for the write
 * route and gets no switcher.
 *
 * See change: add-editor-pane-file-handlers (D2, D5).
 */
import { useSlotClaimsVersion, useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorPaneAction, OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { isPseudoTabViewer } from "../viewer-kinds.js";
import { FileModeSwitcher } from "./FileModeSwitcher.js";
import { claimsForPath, type HandlerClaim, instanceKey, isUnderCwd } from "./file-handler-logic.js";
import { type FileHandlerStore, fileHandlerStore } from "./file-handler-store.js";

export interface FileHandlerPaneArgs {
  enabled: boolean;
  sessionId: string;
  cwd: string;
  openFiles: readonly OpenFile[];
  activeTab: OpenFile | null;
  dispatch: React.Dispatch<EditorPaneAction>;
  store?: FileHandlerStore;
}

export interface FileHandlerPane {
  /** The active tab renders a plugin handler (not the built-in viewer). */
  handlerActive: boolean;
  /** Mode switcher node (null when no claim matches). */
  switcher: ReactNode;
  /** Ref callback for the element the overlay is anchored to. */
  anchorRef: (el: HTMLElement | null) => void;
  /** Close tab `index` through the leave guard; runs `doClose` now or after confirmation. */
  closeTabGuarded: (index: number, doClose: () => void) => void;
  /** Handler-tab refresh: guard, then re-mount. `null` when the active tab is not a handler tab. */
  refreshHandler: () => Promise<boolean> | null;
}

export function useFileHandlerPane({ enabled, sessionId, cwd, openFiles, activeTab, dispatch, store = fileHandlerStore }: FileHandlerPaneArgs): FileHandlerPane {
  const registry = useSlotRegistryOrNull();
  useSlotClaimsVersion();
  // Only the instance map: pane registration churn must not re-render the pane.
  const instances = useSyncExternalStore(store.subscribe, () => store.getState().instances);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const isFile = enabled && !!activeTab && !isPseudoTabViewer(activeTab.viewer);
  const path = activeTab?.path ?? "";
  const claims: HandlerClaim[] = isFile && registry ? claimsForPath(registry.getClaims("editor-pane-file-handler"), path) : [];
  const underCwd = isFile && isUnderCwd(cwd, path);
  const mode = isFile ? activeTab?.handlerMode : undefined;
  const selected = underCwd && mode ? claims.find((c) => c.ref === mode) : undefined;
  const key = underCwd && mode ? instanceKey(sessionId, cwd, path, mode) : null;
  // A plugin disabled live keeps an unsaved instance mounted: the tab stays on it.
  const handlerActive = !!key && (!!selected || instances.has(key));

  // Register the pane + activate the instance. The first run after a session switch
  // is skipped: `sessionId` flips a render BEFORE the pane state reloads, so `activeTab`
  // is still the previous session's; the reload re-runs this effect with the right tab.
  const settled = useRef(sessionId);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const clearMode = useCallback((p: string) => dispatch({ type: "setHandlerMode", path: p, handlerMode: undefined }), [dispatch]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab identity is a deliberate re-run trigger (state reload)
  useEffect(() => {
    if (!enabled) return;
    if (settled.current !== sessionId) {
      settled.current = sessionId;
      return;
    }
    store.setPane({ sessionId, anchor: handlerActive ? anchorEl : null, activeKey: handlerActive ? key : null, clearMode });
    const claim = selectedRef.current;
    if (claim && key) store.activate({ key, sessionId, cwd, path, claim });
  }, [enabled, sessionId, cwd, key, handlerActive, selected?.ref, anchorEl, activeTab, clearMode, path, store]);
  useEffect(() => {
    if (!enabled) return;
    return () => store.setPane(null);
  }, [enabled, store]);

  const sharers = useCallback(
    (k: string, exceptPath: string) =>
      openFiles.filter((f) => f.handlerMode && f.path !== exceptPath && instanceKey(sessionId, cwd, f.path, f.handlerMode) === k),
    [openFiles, sessionId, cwd],
  );

  const select = useCallback(
    async (ref: string | undefined) => {
      if (!activeTab || ref === mode) return;
      const cur = key && store.get(key) ? key : null;
      const alone = cur !== null && sharers(cur, path).length === 0;
      if (cur && alone && !(await store.guard(cur, "mode-switch"))) return;
      dispatch({ type: "setHandlerMode", path, handlerMode: ref });
      if (cur && alone) store.destroy(cur);
    },
    [activeTab, mode, key, path, sharers, dispatch, store],
  );

  const closeTabGuarded = useCallback(
    (index: number, doClose: () => void) => {
      const f = openFiles[index];
      const k = enabled && f?.handlerMode ? instanceKey(sessionId, cwd, f.path, f.handlerMode) : null;
      if (!f || !k || !store.get(k)) return doClose();
      // Another tab still bound to the same instance: closing this one discards nothing.
      if (sharers(k, f.path).length > 0) return doClose();
      void store.guard(k, "close-tab").then((ok) => {
        if (!ok) return;
        doClose();
        store.destroy(k);
      });
    },
    [openFiles, enabled, sessionId, cwd, sharers, store],
  );

  const refreshHandler = useCallback((): Promise<boolean> | null => {
    if (!handlerActive || !key) return null;
    const inst = store.get(key);
    if (!inst) return Promise.resolve(true);
    if (inst.evicted) {
      store.resume(key);
      return Promise.resolve(true);
    }
    return store.guard(key, "refresh").then((ok) => {
      if (ok) store.remount(key);
      return ok;
    });
  }, [handlerActive, key, store]);

  const switcher =
    claims.length > 0 ? <FileModeSwitcher claims={claims} selected={selected?.ref} outside={!underCwd} onSelect={(r) => void select(r)} /> : null;

  return { handlerActive, switcher, anchorRef: setAnchorEl, closeTabGuarded, refreshHandler };
}
