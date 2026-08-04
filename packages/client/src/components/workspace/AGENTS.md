# DOX — packages/client/src/components/workspace

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `AddFoldersDialog.tsx` | Multi-select "Add folders" dialog: wraps `PathPicker` in multi-select mode + removable-pill basket +… → see `AddFoldersDialog.tsx.AGENTS.md` |
| `AddToWorkspaceMenu.tsx` | Popover menu listing workspaces plus `+ New workspace…` entry + remove-from-workspace (when owned). → see `AddToWorkspaceMenu.tsx.AGENTS.md` |
| `GroupedAttachDialog.tsx` | Grouped attach dialog with pill filters + collapsible sections for OpenSpec change selection. See change: add-openspec-change-grouping. |
| `NewWorkspaceDialog.tsx` | Single-input dialog creating a workspace. Exports `NewWorkspaceDialog`. Validates trimmed name 1–80 chars (`NAME_MAX`), calls `onCreate(name)`. Auto-focuses input. See change: `folder-workspaces`. |
| `PinDirectoryDialog.tsx` | Single-select pin-directory dialog (wraps `PathPicker` single-select). → see `PinDirectoryDialog.tsx.AGENTS.md` |
| `SortableWorkspace.tsx` | dnd-kit sortable wrapper for a workspace tier (`data.type: "workspace"`), drop indicator. → see `SortableWorkspace.tsx.AGENTS.md` |
| `SortableWorkspaceFolder.tsx` | dnd-kit sortable wrapper for a folder inside a workspace (`data.type: "workspace-folder"`, carries `wsId`). → see `SortableWorkspaceFolder.tsx.AGENTS.md` |
| `WorkspaceHeader.tsx` | Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`),… → see `WorkspaceHeader.tsx.AGENTS.md` |
