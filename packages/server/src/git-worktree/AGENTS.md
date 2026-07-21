# DOX — packages/server/src/git-worktree

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `folder-head-poll.ts` | Exports `computeFolderGroupKeys(sessions, pinnedDirectories)` = unique resolved folder group-key display… → see `folder-head-poll.ts.AGENTS.md` |
| `folder-head-watcher.ts` | Per-folder `fs.watch` on gitdir HEAD, modeled on `openspec-change-watcher.ts`;… → see `folder-head-watcher.ts.AGENTS.md` |
| `git-operations.ts` | Server-side git commands: branch listing, checkout, init, stash pop. → see `git-operations.ts.AGENTS.md` |
| `git-worktree-compose.ts` | Pure helper composing live `gitWorktree` payload. Exports `composeWorktreePayload(wire, cachedBase)` → `null`… → see `git-worktree-compose.ts.AGENTS.md` |
| `git-worktree-lifecycle.ts` | Pure stderr→code mappers `mapRemoveStderr` / `mapMergeStderr` / `mapPushStderr` / `mapPrStderr` +… → see `git-worktree-lifecycle.ts.AGENTS.md` |
| `git-worktree.ts` | Pure helpers for worktree handling: `slugifyBranch(branch)` (path-safe slug), `parsePorcelainWorktrees(out)`… → see `git-worktree.ts.AGENTS.md` |
| `worktree-init-errors.ts` | Pure `mapInitStderrToHint(stderr)`. Ordered regex table. Codes: EACCES, EBADENGINE/Unsupported engine,… → see `worktree-init-errors.ts.AGENTS.md` |
| `worktree-init-registry.ts` | `createWorktreeInitRegistry({ttlMs?,terminalTtlMs?,sendTo?})`. → see `worktree-init-registry.ts.AGENTS.md` |
| `worktree-init-trust.ts` | TOFU trust store. `isTrusted(repoRoot,hash)`/`recordTrust(repoRoot,hash)` keyed by `repoRoot +… → see `worktree-init-trust.ts.AGENTS.md` |
| `worktree-init.ts` | Worktree-init hook engine. `readInitHook(repoRoot)` parses `.pi/settings.json#worktreeInit` →… → see `worktree-init.ts.AGENTS.md` |
