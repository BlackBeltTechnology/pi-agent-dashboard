# DOX — packages/client/src/lib/git

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `auto-init-worktree.ts` | Fire-and-forget post-spawn worktree auto-init. Exports `maybeAutoInitWorktreeOnSpawn(cwd)`; no-op unless… → see `auto-init-worktree.ts.AGENTS.md` |
| `diff-tree.ts` | Builds directory tree from flat `FileDiffEntry[]`. Exports `TreeNode`, `buildFileTree` (sorts dirs-first alpha, collapses single-child dir chains), `OUTSIDE_WORKSPACE_PATH`. Out-of-cwd entries (`previewable === false`, absolute key) are NOT split into the relative tree (would yield a blank-root node); they collect under a synthetic "outside workspace" group node (basename leaves). See change: opt-in-out-of-cwd-session-diffs. |
| `git-api.ts` | Client git/worktree API helpers for BranchPicker + WorktreeSpawnDialog. → see `git-api.ts.AGENTS.md` |
| `git-status-cache.ts` | Per-cwd git-status cache for the on-demand delivery half. → see `git-status-cache.ts.AGENTS.md` |
| `worktree-init-bus.ts` | Module-singleton bus for `worktree_init_*` events. `subscribeInit(requestId,listener)` (legacy) +… → see `worktree-init-bus.ts.AGENTS.md` |
| `worktree-init-store.ts` | cwd-keyed client run store (`useSyncExternalStore`). Single source for the friendly feedback surfaces… → see `worktree-init-store.ts.AGENTS.md` |
