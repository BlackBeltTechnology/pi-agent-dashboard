# auto-init-worktree.ts — index

Fire-and-forget post-spawn worktree auto-init. Exports `maybeAutoInitWorktreeOnSpawn(cwd)`; no-op unless `worktree-auto-init` pref ON AND init-status `{hasHook,needsInit,trusted}` all true. Never sends `confirmHash` (TOFU invariant). friendlier-worktree-init: no longer discards a requestId — registers the run in `initStore` (startRun → markDone/markFailed) so running + FAILED states are visible + retryable (previously silent). See change: auto-init-worktree-on-spawn, friendlier-worktree-init.
