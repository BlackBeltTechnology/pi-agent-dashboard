# pending-goal-link-registry.ts — index

In-memory FIFO queue of pending `goalId` link intents per cwd. Goal route enqueues `{cwd, goalId}` pre-spawn; `session_register` consumes head, writes `goalId` to session `.meta.json`, links sessionId into goal store. Exports `createPendingGoalLinkRegistry`, `PendingGoalLinkRegistry`, `PENDING_GOAL_LINK_TTL_MS` (60s), `PENDING_GOAL_LINK_CAP` (8). Cwd-normalized via `safeRealpathSync`. Sibling to `pending-worktree-base-registry.ts`. See change: add-goals-folder-page.
