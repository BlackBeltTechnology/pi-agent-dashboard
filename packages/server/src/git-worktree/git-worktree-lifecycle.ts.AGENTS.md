# git-worktree-lifecycle.ts — index

Pure stderr→code mappers `mapRemoveStderr` / `mapMergeStderr` / `mapPushStderr` / `mapPrStderr` + `parsePrUrl` + `parseShortstat`. Drives stable error codes (`dirty_worktree`, `branch_not_merged`, `merge_conflict`, `non_fast_forward`, `auth_failed`, `gh_not_authed`, `pr_exists`, ...) emitted by `/api/git/worktree/*`. See change: add-worktree-lifecycle-actions.
