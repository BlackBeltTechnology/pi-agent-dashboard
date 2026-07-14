# SplitWorkspaceContext.tsx — index

Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. Exposes `openInSplit`, `toggleSplit`, `pendingScroll`, `changedFiles`, `clearChanged`. Wires filename-search + open-files watch effect. Adds `openChanges()`, `openDiffTab()`, `changesRevealSignal` for the Changes rail + `diff:` viewer tabs. See change: split-editor-workspace. See change: add-change-summary-table.
