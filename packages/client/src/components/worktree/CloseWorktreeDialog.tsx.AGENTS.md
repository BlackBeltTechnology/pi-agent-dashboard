# CloseWorktreeDialog.tsx — index

Confirms worktree removal. Handles `active_sessions` guard: shuts listed sessions down then retries with `--force`. `--force` toggle for `dirty_worktree` / `branch_not_merged`. See change: add-worktree-lifecycle-actions.
