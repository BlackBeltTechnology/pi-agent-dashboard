# WorkspaceHeader.tsx — index

Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`), folder count, collapse chevron, kebab menu (rename/delete). Drag handle via `useWorkspaceDragHandle`. `confirmDelete` gates non-empty workspaces with `window.confirm`. `NAME_MAX = 80`.
