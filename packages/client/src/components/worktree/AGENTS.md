# DOX — packages/client/src/components/worktree

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `BranchCombobox.tsx` | Collapsed typeahead combobox. Trigger button + popover with filter input + `BranchListbox`. → see `BranchCombobox.tsx.AGENTS.md` |
| `BranchListbox.tsx` | Presentational branch list. Splits local/remote with separator. Current-branch `●` marker. Remote badge. → see `BranchListbox.tsx.AGENTS.md` |
| `BranchPicker.tsx` | Typeahead branch picker with keyboard navigation. Delegates row rendering + keyboard nav to `BranchListbox`. → see `BranchPicker.tsx.AGENTS.md` |
| `BranchSwitchDialog.tsx` | Modal dialog for git branch switch. Exports `BranchSwitchDialog`. → see `BranchSwitchDialog.tsx.AGENTS.md` |
| `CloseWorktreeDialog.tsx` | Confirms worktree removal. Handles `active_sessions` guard: shuts listed sessions down then retries with… → see `CloseWorktreeDialog.tsx.AGENTS.md` |
| `CommitDialog.tsx` | Placement-agnostic commit dialog (`cwd` + `sessionId`). File picker (checkbox + `+/−`, select-all/none),… → see `CommitDialog.tsx.AGENTS.md` |
| `GitIdentity.tsx` | `GitIdentity({session})`: worktree identity for the dock Changes lane header (moved from the composer strip). Branch, `← base` only when known, dirty count, `↑ahead`/`↓behind`, `no local changes` marker only with `gitStatus` (never claims sync); every marker has a text alternative; tooltip `name — mainPath`. Test ids `composer-git-*`. See change: add-composer-dock (4.1). |
| `GitDirtyPill.tsx` | Shared dirty/drift indicator on both git surfaces (`GitInfo` card, `GroupGitInfo` header). → see `GitDirtyPill.tsx.AGENTS.md` |
| `lazy-worktree-dialogs.ts` | Code-splits click-only worktree dialogs off the entry chunk. Exports `worktreeDialogLoaders` + `LazyCloseWorktreeDialog`, `LazyMergeConfirmDialog`. See change: redesign-composer-session-strip. |
| `ManageWorktreesDialog.tsx` | Manage-worktrees `Dialog size="lg"` hosting `<WorktreeList mode="manage" />`. Owns fetch, bulk `remove-batch`, prune;… → see `ManageWorktreesDialog.tsx.AGENTS.md` |
| `MergeConfirmDialog.tsx` | Fetches `/api/git/worktree/diff-stat`; renders 5-line summary; delete-branch checkbox. → see `MergeConfirmDialog.tsx.AGENTS.md` |
| `PrCombobox.tsx` | Typeahead combobox for PR selection. Fetches `GET /api/git/pull-requests` lazily on first open. → see `PrCombobox.tsx.AGENTS.md` |
| `worktree-actions.ts` | Pure `deriveWorktreeActions(session,{ghAvailable,working})` (push/openPr/merge/close + `hasPr`), shared by `WorktreeActionsMenu` and the session menu; `runWorktreePush`/`runWorktreeOpenPr` return toast outcomes; `labelForCode`. See change: add-session-actions-flyout. |
| `worktree-runners.ts` | `openHttpUrlInNewTab` classifies with `classifyUrl` (external / loopback only) before the anchor click. See change: harden-client-sinks. |
| `WorktreeActionsMenu.tsx` | Exports `WorktreeActionsMenu`, `PrSegment` (reused by the card header git row) + `__resetGhAvailableCache`. → see `WorktreeActionsMenu.tsx.AGENTS.md` |
| `WorktreeInitButton.tsx` | Hook-run-only Initialize control per directory/worktree row. → see `WorktreeInitButton.tsx.AGENTS.md` |
| `WorktreeInitChip.tsx` | Presentational worktree-init status chip (variant A/D1). Fills its banner (`w-full`, capped 420/460 px), `--text-secondary` body copy, long tokens wrap. See change: fix-worktree-init-chip-overflow. → see `WorktreeInitChip.tsx.AGENTS.md` |
| `WorktreeInitStack.tsx` | Concurrent-init corner surface (variant E2). Reads `useAllInitRuns()`; renders only for ≥ 2 runs. → see `WorktreeInitStack.tsx.AGENTS.md` |
| `WorktreeList.tsx` | Shared worktree list, `mode="spawn"`/`"manage"`. Client-side filter (default `isMain || (!detached && inTree)`), chip… → see `WorktreeList.tsx.AGENTS.md` |
| `WorktreeSpawnDialog.tsx` | Fullscreen `+Worktree` dialog. §1 delegated to `WorktreeList mode="spawn"`; create-new form (base picker,… → see `WorktreeSpawnDialog.tsx.AGENTS.md` |
