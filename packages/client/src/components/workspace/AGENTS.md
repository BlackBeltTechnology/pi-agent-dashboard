# DOX — packages/client/src/components/workspace

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `AddFoldersDialog.tsx` | File-manager "Add folders" dialog: `PathPicker` click-selects / dbl-click opens + status line +… → see `AddFoldersDialog.tsx.AGENTS.md` |
| `AddToWorkspaceMenu.tsx` | Popover menu listing workspaces plus `+ New workspace…` entry + remove-from-workspace (when owned). → see `AddToWorkspaceMenu.tsx.AGENTS.md` |
| `GroupedAttachDialog.tsx` | Grouped attach dialog with pill filters + collapsible sections for OpenSpec change selection. See change: add-openspec-change-grouping. |
| `NewWorkspaceDialog.tsx` | Single-input dialog creating a workspace. Exports `NewWorkspaceDialog`. Validates trimmed name 1–80 chars (`NAME_MAX`), calls `onCreate(name)`. Auto-focuses input. See change: `folder-workspaces`. |
| `PinDirectoryDialog.tsx` | Single-select pin-directory dialog (wraps `PathPicker` single-select). → see `PinDirectoryDialog.tsx.AGENTS.md` |
| `PinnedTierDropZone.tsx` | Eject drop target for a `workspace-folder` drag. Exports `PinnedTierDropZone`, `PINNED_TIER_DROP_ID = "__pinned_tier__"` (namespaced sentinel, cannot collide with a folder cwd or `ws:` id). Droppable `data.type: "pinned-tier"`, `min-height: PINNED_TIER_MIN_HEIGHT_PX`, testid `pinned-tier-drop-zone`. Mounted by `SessionList`'s `WorkspaceFolderEjectZone` for EVERY `workspace-folder` drag (dnd-kit `active`), pinned groups visible or not. Drop on a pinned group ejects too — same `toWorkspaceId: null` outcome, no conflict. See changes: drag-folders-across-workspaces, fix-sidebar-folder-visibility. |
| `SortableWorkspace.tsx` | dnd-kit sortable wrapper for a workspace tier (`data.type: "workspace"`), drop indicator. → see `SortableWorkspace.tsx.AGENTS.md` |
| `SortableWorkspaceFolder.tsx` | dnd-kit sortable wrapper for a folder inside a workspace (`data.type: "workspace-folder"`, carries `wsId`). → see `SortableWorkspaceFolder.tsx.AGENTS.md` |
| `WorkspaceHeader.tsx` | Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`),… also a header-sized append droppable `wsh:<id>` → see `WorkspaceHeader.tsx.AGENTS.md` |
