# WorkspaceHeader.tsx — index

Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`), folder count, collapse chevron, kebab menu (rename/delete). Drag handle via `useWorkspaceDragHandle`. `confirmDelete` gates non-empty workspaces with `window.confirm`. `NAME_MAX = 80`.
 Header bar gains neutral panel bevel `shadow-[inset_0_1px_0_var(--elevation-rim),0_2px_4px_var(--shadow-card)]` \u2014 raised-surface affordance, no added color. See change: add-panel-elevation-system.
