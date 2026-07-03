# SplitWorkspaceContext.tsx — index

Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. Exposes `openInSplit`, `toggleSplit`, `pendingScroll`, `changedFiles`, `clearChanged`. Wires filename-search + open-files watch effect. See change: split-editor-workspace.
