# pending-worktree-base-registry.ts — index

In-memory FIFO queue of pending `gitWorktreeBase` intents per cwd. Browser `spawn_session` enqueues base after worktree dialog; `session_register` consumes head. Exports `createPendingWorktreeBaseRegistry`, `PendingWorktreeBaseRegistry` (`enqueue`/`consume`/`size`), `PENDING_WORKTREE_BASE_TTL_MS` (60s), `PENDING_WORKTREE_BASE_CAP` (8). Sibling to `pending-goal-link-registry.ts`. See change: add-worktree-spawn-dialog.
