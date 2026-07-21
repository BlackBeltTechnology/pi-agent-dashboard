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
| `GitDirtyPill.tsx` | Shared dirty/drift indicator on both git surfaces (`GitInfo` card, `GroupGitInfo` header). → see `GitDirtyPill.tsx.AGENTS.md` |
| `MergeConfirmDialog.tsx` | Fetches `/api/git/worktree/diff-stat`; renders 5-line summary; delete-branch checkbox. → see `MergeConfirmDialog.tsx.AGENTS.md` |
| `PrCombobox.tsx` | Typeahead combobox for PR selection. Fetches `GET /api/git/pull-requests` lazily on first open. → see `PrCombobox.tsx.AGENTS.md` |
| `WorktreeActionsMenu.tsx` | Exports `WorktreeActionsMenu` + `__resetGhAvailableCache`. → see `WorktreeActionsMenu.tsx.AGENTS.md` |
| `WorktreeInitButton.tsx` | Hook-run-only Initialize control per directory/worktree row. → see `WorktreeInitButton.tsx.AGENTS.md` |
| `WorktreeInitChip.tsx` | Presentational worktree-init status chip (variant A/D1). running → `⚙ Initializing… · {elapsed}` + slim… → see `WorktreeInitChip.tsx.AGENTS.md` |
| `WorktreeInitStack.tsx` | Concurrent-init corner surface (variant E2). Reads `useAllInitRuns()`; renders only for ≥ 2 runs. → see `WorktreeInitStack.tsx.AGENTS.md` |
| `WorktreeSpawnDialog.tsx` | Fullscreen `+Worktree` dialog. Lists existing worktrees (one-click `Spawn →`) + create-new form (base picker,… → see `WorktreeSpawnDialog.tsx.AGENTS.md` |
