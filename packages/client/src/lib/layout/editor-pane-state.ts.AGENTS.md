# editor-pane-state.ts — index

Per-session pane state + localStorage persistence under `pi-dashboard:editor-pane:<sessionId>`. `editorPaneReducer` (openFile idempotent, closeTab, closeByPath, setActive, toggleTreeRoot, reorderTabs). `closeByPath` closes the tab addressed by full path (stable across index shifts; reused by the terminal-tab reconcile loop). openFile + setActive also expand the file's `ancestorDirs()` into `treeOpenRoots` to reveal its row (#5). `useEditorPaneState(sessionId)` hook loads on session change, persists on change. Corrupt JSON / quota errors logged, fall back to empty state. `VALID_VIEWERS` includes `"diff"` + `"terminal"` (persisted `term:<id>` tabs survive reload; reconciled against live terminals after load). See change: add-internal-monaco-editor-pane. See change: improve-content-editor. See change: add-change-summary-table. See change: terminals-in-tabbed-panes.

See change: surface-denial-remedy-in-previews — `OpenFile.autoOpened` persisted; `isValidState` boolean-only; `loadEditorPaneState` seeds from `restrictCsp`. D4 rules: new tab = opener; auto-open of inactive tab → `true`, of active → unchanged; operator open/`setActive`/operator `closeTab` re-point → `false`; background + `closeByPath` unchanged (`activateAt`).

See change: add-browser-editor-pane-tab — `VALID_VIEWERS` derived from `OPEN_PATH_VIEWERS ∪ PSEUDO_TAB_VIEWERS` (`viewer-kinds.ts`); `dropUnknownViewers` drops only unknown-viewer entries before `isValidState` (structure stays all-or-nothing); `activeIndex` keeps surviving active tab, else clamps (D2).

See change: add-editor-pane-file-handlers — `OpenFile.handlerMode?: "<pluginId>/<claimId>"` (undefined = built-in); action `setHandlerMode {path, mode}` (no-op on unknown path/unchanged); `dropInvalidHandlerModes` strips a non-string value for that tab before `isValidState` (which also has the explicit `typeof` check); unknown claims are NOT validated at load (resolved at render).

`OpenFile.reloadNonce?`/`updatedByAgent?`; `openFile.bump`; `ackUpdate` action. See change: improve-canvas-html-and-url-ux.

Actions `closeTabs {paths}` (path-keyed; active survives, else nearest right then left; operator reactivation; unknown paths → same state object) and `expandTreeRoots {relPaths}` (expand-only merge). Persisted shape unchanged. See change: scope-anchor-editor-pane-controls (D5, D11).
