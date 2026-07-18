# SplitWorkspace.tsx — index

Pure layout, 3 modes via `mode` prop: `closed` (chat + right-edge Editor peek), `split` (chat+divider+editor), `full` (editor + leading Chat peek; ChatView kept mounted hidden). Stable chat/editor keys → no remount. `onModeChange` for peeks/chevrons. See change: split-editor-workspace. See change: editor-layout-modes.
