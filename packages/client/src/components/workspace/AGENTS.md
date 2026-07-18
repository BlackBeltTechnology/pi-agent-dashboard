# DOX — packages/client/src/components/workspace

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `AddToWorkspaceMenu.tsx` | Popover menu listing workspaces plus `+ New workspace…` entry. Surfaced on folder action bar. Exports `AddToWorkspaceMenu`. Closes on outside click / Escape. |
| `GroupedAttachDialog.tsx` | Grouped attach dialog with pill filters + collapsible sections for OpenSpec change selection. See change: add-openspec-change-grouping. |
| `NewWorkspaceDialog.tsx` | Single-input dialog creating a workspace. Exports `NewWorkspaceDialog`. Validates trimmed name 1–80 chars (`NAME_MAX`), calls `onCreate(name)`. Auto-focuses input. See change: `folder-workspaces`. |
| `PinDirectoryDialog.tsx` | Dialog to pin directory (wraps PathPicker) |
| `SortableWorkspace.tsx` | dnd-kit sortable wrapper for a workspace tier (`data.type: "workspace"`), drop indicator. → see `SortableWorkspace.tsx.AGENTS.md` |
| `SortableWorkspaceFolder.tsx` | dnd-kit sortable wrapper for a folder inside a workspace (`data.type: "workspace-folder"`, carries `wsId`). → see `SortableWorkspaceFolder.tsx.AGENTS.md` |
| `WorkspaceHeader.tsx` | Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`),… → see `WorkspaceHeader.tsx.AGENTS.md` |
