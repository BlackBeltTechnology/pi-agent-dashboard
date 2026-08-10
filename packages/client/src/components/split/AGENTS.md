# DOX — packages/client/src/components/split

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `RestoreTab.tsx` | Rotated vertical restore tab — shared collapse/restore idiom for collapsed chat/editor pane peeks + collapsed session rail. In-flow Fluent SplitView `inline` flex sibling (PUSHES content aside, never overlays) — structural fix for the maximized-window overlap bug. See change: fold-oversized-agents-directories. |
| `SeamGrip.tsx` | Always-visible dotted resize grip — shared seam signifier for the split divider + session-list resize seam (NN/g: signifier always visible, not hover-only). Purely decorative `pointer-events-none` so it never swallows the seam's drag `mousedown`. See change: fold-oversized-agents-directories. |
| `LayoutModeSwitch.tsx` | Header `Chat│Split│Editor` segmented switch. WAI-ARIA radiogroup (3 `role=radio`, roving tabindex,… → see `LayoutModeSwitch.tsx.AGENTS.md` |
| `SessionSplitView.tsx` | Connects context → `SplitWorkspace` (editor slot=`EditorPane`), passing `mode`/`onModeChange`. → see `SessionSplitView.tsx.AGENTS.md` |
| `SplitDivider.tsx` | Draggable divider (outer chat/editor + inner rail). Reports pointer coord; orientation-aware cursor. → see `SplitDivider.tsx.AGENTS.md` |
| `SplitWorkspace.tsx` | Pure layout, 3 modes via `mode` prop: `closed` (chat + right-edge Editor peek), `split`… → see `SplitWorkspace.tsx.AGENTS.md` |
| `SplitWorkspaceContext.tsx` | Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. → see `SplitWorkspaceContext.tsx.AGENTS.md` |
