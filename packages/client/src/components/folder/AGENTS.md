# DOX — packages/client/src/components/folder

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `CwdGonePill.tsx` | Red `cwd gone` pill next to `WorktreePill` when `session.cwdMissing`. See change: add-worktree-lifecycle-actions. |
| `DirectoryHomeView.tsx` | Directory home page for the bare `/folder/:encodedCwd` route. → see `DirectoryHomeView.tsx.AGENTS.md` |
| `FolderActionBar.tsx` | Sidebar folder-group action bar. Buttons: Initialize, Clean up broken. Directory Settings gear + Terminals + Editor REMOVED; renders `null` when it holds nothing. → see `FolderActionBar.tsx.AGENTS.md` |
| `FolderActionsMenu.tsx` | The folder header's single trailing control. `mdiFolderCogOutline` trigger (`folder-actions-menu-<cwd>`, `aria-haspopup=menu`, `aria-expanded`, `stopPropagation`) → grouped popover / mobile sheet (`folder-actions-menu-panel-<cwd>`, `role=menu`, `data-menu-form=sheet|popover`). Exports `FolderActionsMenu`, `FolderMenuItem`, `FOLDER_MENU_GROUPS`, `FolderMenuGroup`. Host-owned group order `workspace` → `directory`; a group renders only when non-empty (`folder-menu-group-<group>`). Items `role=menuitem` + `folder-menu-item-<id>`; `FolderMenuItem.node` lets an item render its own node (add-to-workspace keeps `add-to-workspace-btn-<cwd>` + its popover). Caller owns `open` — `SessionList` keys it by SCOPE `folder:<cwd>`. ArrowDown/Up rove `[role=menuitem]`; Escape closes + refocuses trigger; outside mousedown/touchstart closes. Sheet gates on `useMobile()` (compound `<768w OR <600h`, reused verbatim) via `DialogPortal`; desktop uses `usePopoverFlip`. `mdiDotsHorizontal` REJECTED — `WorktreeActionsMenu` already renders it inside the folder body. See change: add-folder-actions-menu. |
| `FolderEditorView.tsx` | Folder-scoped internal Monaco pane. Wraps `SplitWorkspaceProvider` keyed by `folderPaneId(cwd)`, renders… → see `FolderEditorView.tsx.AGENTS.md` |
| `FolderNeedsYouPill.tsx` | Folder-header "N need you" rollup pill. Counts chat-routed ask_user child sessions; excludes widget-bar via… → see `FolderNeedsYouPill.tsx.AGENTS.md` |
| `FolderSpawnButtons.tsx` | Stacked spawn buttons in folder header: `+ New Session` (green, always) + `+ New Worktree` (orange, gated by `showWorktree`). Min-height 44px on mobile. Exports `FolderSpawnButtons`. |
| `FolderStatusRollup.tsx` | Compact working/idle session dot-counts for a COLLAPSED folder header. Excludes `ended`; `needs-you` surfaced by sibling `FolderNeedsYouPill`. Renders nothing when both 0. Colors via `--status-working`/`--status-idle`. See change: condense-collapsed-folder-header. |
