# openspec-board-worktree.ts — index

`deriveWorktreeProgress(session, changeName, mainDone, openspecMap)`. Returns null for non-worktree session. Reads worktree own OpenSpecData by `session.cwd`. Computes `{name, base, done, total, delta}`; delta = worktree-done minus main-done. See change: redesign-openspec-board.
