# git-worktree-compose.ts — index

Pure helper composing live `gitWorktree` payload. Exports `composeWorktreePayload(wire, cachedBase)` → `null` (bridge cleared), merged `GitWorktreeInfo` with `base` filled from cached server value when bridge omitted it, or `undefined` (bridge omitted field → caller leaves existing value untouched). No state/IO deps; unit-testable. See change: add-worktree-spawn-dialog.
