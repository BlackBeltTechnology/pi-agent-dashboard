# git-worktree.ts — index

Pure helpers for worktree handling: `slugifyBranch(branch)` (path-safe slug), `parsePorcelainWorktrees(out)` (`git worktree list --porcelain` → records), `resolveDefaultBase(cwd, head)` (origin/HEAD → main → master → HEAD fallback), `ensureWorktreeExcludeLine(cwd)` (idempotent append of `.worktrees/` to `.git/info/exclude`). See change: add-worktree-spawn-dialog. Re-exports `localNameOf` from shared helpers (`localNameOf("origin/foo")==="foo"`, `localNameOf("foo")==="foo"`). See change: worktree-checkout-existing-branch.
