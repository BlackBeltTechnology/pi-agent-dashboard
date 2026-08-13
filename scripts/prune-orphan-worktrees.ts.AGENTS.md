# prune-orphan-worktrees.ts — index

One-shot: `rm -rf` orphan `.worktrees/*` husk dirs (on disk, absent from `git worktree list`) left by kb DB handles recreating `.pi/dashboard/kb` after `git worktree remove`. Dry-run default; `--write` deletes. Guarded to parent-repo `.worktrees/` subtree (symlink-resolved via realpath), skips registered worktrees + main checkout. Idempotent. See change: sweep-worktree-residual-on-remove.
