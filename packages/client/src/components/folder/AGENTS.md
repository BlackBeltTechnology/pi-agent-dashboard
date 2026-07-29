# DOX — packages/client/src/components/folder

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `CwdGonePill.tsx` | Red `cwd gone` pill next to `WorktreePill` when `session.cwdMissing`. See change: add-worktree-lifecycle-actions. |
| `DirectoryHomeView.tsx` | Directory home page for the bare `/folder/:encodedCwd` route. → see `DirectoryHomeView.tsx.AGENTS.md` |
| `FolderActionBar.tsx` | Sidebar folder-group action bar. Buttons: Initialize, Clean up broken, Directory Settings (gear). Terminals + Editor REMOVED (reachable from Directory home / ChatView); right-grouped on the git row. → see `FolderActionBar.tsx.AGENTS.md` |
| `FolderEditorView.tsx` | Folder-scoped internal Monaco pane. Wraps `SplitWorkspaceProvider` keyed by `folderPaneId(cwd)`, renders… → see `FolderEditorView.tsx.AGENTS.md` |
| `FolderNeedsYouPill.tsx` | Folder-header "N need you" rollup pill. Counts chat-routed ask_user child sessions; excludes widget-bar via… → see `FolderNeedsYouPill.tsx.AGENTS.md` |
| `FolderSpawnButtons.tsx` | Stacked spawn buttons in folder header: `+ New Session` (green, always) + `+ New Worktree` (orange, gated by `showWorktree`). Min-height 44px on mobile. Exports `FolderSpawnButtons`. |
| `FolderStatusRollup.tsx` | Compact working/idle session dot-counts for a COLLAPSED folder header. Excludes `ended`; `needs-you` surfaced by sibling `FolderNeedsYouPill`. Renders nothing when both 0. Colors via `--status-working`/`--status-idle`. See change: condense-collapsed-folder-header. |
| `FolderToolsMenu.tsx` | Accessible `⋯ Folder tools` overflow surface for secondary folder plugin/OpenSpec sections; suppresses its trigger when no eligible section exists. See change: folder-tools-overflow-menu. |
