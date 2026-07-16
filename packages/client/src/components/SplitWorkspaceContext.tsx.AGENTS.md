# SplitWorkspaceContext.tsx — index

Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. Exposes `openInSplit`, `setMode` (Chat│Split│Editor switch), `pendingScroll`, `changedFiles`, `clearChanged`. Content openers set `mode:"split"`. Wires filename-search + open-files watch effect (keyed `mode!=="closed"`). Adds `openChanges()`, `openDiffTab()`, `changesRevealSignal` for the Changes rail + `diff:` viewer tabs. `toggleSplit` deleted. See change: split-editor-workspace. See change: add-change-summary-table. See change: editor-layout-modes.
