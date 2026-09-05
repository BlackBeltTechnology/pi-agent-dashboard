# useInitStatus.ts — index

`useInitStatus(cwd) → { status: WorktreeInitStatus\|null, refetch }`. Single shared `GET /api/git/worktree/init-status` probe for a folder-action-bar row; feeds BOTH `ProjectInitButton` (scaffold) and `WorktreeInitButton` (hook run) from one fetch (avoids double-probe). `refetch` re-issues after a hook run flips the gate. Fail-open via `fetchWorktreeInitStatus`. See change: distinguish-initialize-actions.
