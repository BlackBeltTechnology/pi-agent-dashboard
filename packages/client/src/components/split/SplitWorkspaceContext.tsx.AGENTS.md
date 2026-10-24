# SplitWorkspaceContext.tsx — index

Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. Exposes `openInSplit`, `setMode` (Chat│Split│Editor switch), `pendingScroll`, `changedFiles`, `clearChanged`. Content openers set `mode:"split"`. Wires filename-search + open-files watch effect (keyed `mode!=="closed"`). Adds `openChanges()`, `openDiffTab()`, `changesRevealSignal` for the Changes rail + `diff:` viewer tabs. `toggleSplit` deleted. See change: split-editor-workspace. See change: add-change-summary-table. See change: editor-layout-modes. Adds a `terminal` slice (`useTerminalPaneTabs`): provider props `terminals`, `autoSurfaceTerminals`, `onCreateTerminal`/`onKillTerminal`/`onRenameTerminal`/`onTerminalTitle` → context `terminal: TerminalPaneTabs`. Session split threads cwd terminals opt-in; `FolderEditorView` sets `autoSurfaceTerminals`. `EMPTY_TERMINALS` stable default. Provider props `focusOnMount`/`terminalsReady`/`onFocusConsumed` forward the folder pane's one-shot terminal-focused entry. See change: terminals-in-tabbed-panes. See change: fix-terminals-action-opens-terminal.

See change: add-lazy-terminal-diff-bootstrap — lazy boundary (D2: `React.lazy` + local `Suspense`); see the directory AGENTS.md row for the runtime detail.

See change: surface-denial-remedy-in-previews — `openInSplit` opts gain `autoOpened` (provenance; independent of `background`/`restrictCsp`) → `openFile` action.

See change: add-browser-editor-pane-tab — `openPluginTab(path): boolean` (claimed-prefix check via `findEditorPaneTabClaim`, then idempotent `openFile{viewer:"plugin"}` + `ensureRevealed`); file-watch set (`openPathsKey`) excludes every pseudo-tab/plugin path.

Session scope (`changeDetection`): candidates (`changedFiles` prop is now Map<path,gen>) are verified by `use-change-verification`; context `changedFiles` = verified set; adds `captureBaseline`, `trackedFileWrite`, `resyncWatch`, `changeDetection`; `watchNonce` re-sends `watch_files`; wraps children in `TrackedFileWriteProvider`. See change: gate-changed-on-disk-by-content.

See change: add-editor-pane-file-handlers — context adds `setBaseline(path, digest)`; `trackedFileWrite` type = `TrackedFileWrite` (optional `send`). Consumed by `FileHandlerLayer`'s pane bridge.

See change: improve-canvas-html-and-url-ux — adds `openStaticTarget(cwd,path,{background,opener,bump})` (tab `static:<abs file>`, viewer `live-server`, one tab per file); `openLiveTarget` opts gain `opener` (`agent` sets `autoOpened`) and `bump`. `bump` on an existing tab: inactive → `reloadNonce+1`, active → `updatedByAgent`.

`hasFileSearch` (true only when the provider received `onFilenameSearch`; folder providers leave it false): gates the rail Search view, the `+` menu's Open file…, the Search-tabs fall-through and the Cmd-P / Cmd-Shift-F interception. See change: scope-anchor-editor-pane-controls (D4).
`cwdUnavailable` (provider prop → context value): empty `cwd` is permanent. Empty `cwd` also makes `onFilenameSearch` a no-op (watch effects already skip it). See change: fix-archived-session-view-header-and-stale-artifact-tab (D4).
