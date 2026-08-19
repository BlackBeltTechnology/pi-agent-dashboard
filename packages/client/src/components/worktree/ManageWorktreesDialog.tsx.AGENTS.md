# ManageWorktreesDialog.tsx — index

Manage-worktrees surface: `Dialog size="lg"` hosting `<WorktreeList mode="manage" />` (design D3), opened from the folder actions menu. Owns fetching (`fetchWorktrees`), per-row removal (delegates to `CloseWorktreeDialog` so `active_sessions` + `dirty_worktree` escalations are inherited, not reimplemented), the bulk `removeWorktreeBatch` path, and `pruneWorktrees`.

Batch retries carry the ORIGINAL `deleteBranch` intent and the per-item `sessionIds` from the batch response. Failures render as a top summary linking to each failing row plus the list's inline per-row strips. Prune reports a REPO-GLOBAL count ("across this repository"), never implying one row. See change: manage-worktrees-filter-cleanup.
