# worktree-init-store.ts — index

cwd-keyed client run store (`useSyncExternalStore`). Single source for the friendly feedback surfaces (folder-row chip, session-card sub-state, concurrent stack). `initStore` API: `startRun`/`markDone`/`markFailed`/`dismiss`/`seed(activeRuns)`/`getRun`/`getAllSnapshot`/`subscribe`. Fed by optimistic startRun, `subscribeInitByCwd` ws stream, boot `seed`. done flashes `DONE_FLASH_MS`(2s) then auto-collapses; failed sticky (no timer). Hooks `useInitRun(cwd)` + `useAllInitRuns()`. See change: friendlier-worktree-init.
