# DOX — packages/client/src/components/editor-pane

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `BinaryWarn.tsx` | Binary-file tab. Shows "binary, open externally" notice. Fetches detected editors via `fetchEditors(cwd)`. Renders "Open in <name>" buttons calling `openEditor`. No content fetched. See change: add-internal-monaco-editor-pane. |
| `ChangedOnDiskBanner.tsx` | Per-tab changed-on-disk banner. Refresh re-fetches; Dismiss keeps stale view. No auto-reload. See change: split-editor-workspace. |
| `EditorFileTree.tsx` | Lazy file-tree rail rooted at session cwd. Expands one level per click. Lists files+dirs by merging `/api/file` name list with `/api/browse` dir-subset (`/api/browse` dirs-only). Clicking file calls `onOpenFile(rel, viewer)` via shared `fileKind`. `treeOpenRoots` persisted. See change: add-internal-monaco-editor-pane. |
| `EditorPane.tsx` | Editor pane shell. Composes `EditorTabs` + collapsible `EditorFileTree` + active viewer (`viewerRegistry`). Replaces ChatView in content area, mirrors FileDiffView. Read-only v1. Header: back, tree-toggle, refresh. Footer: viewer kind, language, path. State via `useEditorPaneState(sessionId)`. See change: add-internal-monaco-editor-pane. Now controlled by `SplitWorkspaceContext`. Adds inner rail divider, search panel, changed-on-disk banner, unsplit button, Cmd-P/Cmd-Shift-F. See change: split-editor-workspace. |
| `EditorSearchPanel.tsx` | Dual-mode search. Filenames=bridge walk, Contents=`GET /api/grep`. Regexp toggle, min-3-char + debounce, keyboard nav ↑↓/↵/Esc. Injected search fns. See change: split-editor-workspace. |
| `EditorTabs.tsx` | Horizontal tab strip. Click activate, `×`/middle-click/Ctrl+Cmd-W close, drag reorder. Label = basename, tooltip = rel path. See change: add-internal-monaco-editor-pane. |
| `ImageViewer.tsx` | Image tab. Streams `/api/file/raw` into `<img>`. Pan/zoom via `useZoomPan`. See change: add-internal-monaco-editor-pane. |
| `MarkdownEditor.tsx` | Controlled editable Monaco buffer. Props `{value,onChange,readOnly}`. language=markdown, wordWrap on, minimap off. Lazy-mounts behind Suspense in InstructionsPage. See change: directory-settings-page-and-scoped-md-editing. |
| `MarkdownViewer.tsx` | Markdown tab. Fetches text via `/api/file`. Renders through `MarkdownContent` (frontmatter=properties). `pi-asset:` resolves via ambient `SessionAssetsContext`. See change: add-internal-monaco-editor-pane. |
| `monaco-setup.ts` | Shared Monaco bootstrap. Worker `?worker` imports + MonacoEnvironment + loader.config. Side-effect import by MonacoBuffer + MarkdownEditor. See change: directory-settings-page-and-scoped-md-editing. |
| `MonacoBuffer.tsx` | Heavy lazy Monaco chunk. Imports `monaco-editor` + `@monaco-editor/react`. Bundles editor/json/css/html workers via `?worker`; ts.worker omitted (read-only, no LSP); ts/js diagnostics disabled. Read-only. Theme via `buildMonacoTheme`, recolors on theme/mode change. Fetches content via `/api/file`. Scrolls to line. See change: add-internal-monaco-editor-pane. Worker bootstrap moved to monaco-setup.ts. See change: directory-settings-page-and-scoped-md-editing. |
| `PdfViewer.tsx` | PDF tab. `<object data=/api/file/raw type=application/pdf>`. Download-link fallback. See change: add-internal-monaco-editor-pane. |
| `types.ts` | `ViewerProps` contract `{ cwd, path, kind, mimeType, size, line? }`. Shared by all viewers. See change: add-internal-monaco-editor-pane. |
| `viewer-registry.ts` | `viewerRegistry` maps `ViewerKind`→component. monaco=`React.lazy(MonacoBuffer)` boundary. image/pdf/markdown/binary-warn eager. See change: add-internal-monaco-editor-pane. |
