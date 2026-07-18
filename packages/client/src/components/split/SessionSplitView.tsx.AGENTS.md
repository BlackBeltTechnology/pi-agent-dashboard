# SessionSplitView.tsx — index

Connects context → `SplitWorkspace` (editor slot=`EditorPane`), passing `mode`/`onModeChange`. `SplitRouteSync` opens split from `/session/:id/editor` deep-link via `openInSplit` (else `mode:"split"`). See change: split-editor-workspace. See change: editor-layout-modes.
