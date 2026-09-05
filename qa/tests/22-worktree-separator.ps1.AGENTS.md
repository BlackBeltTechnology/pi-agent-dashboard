# 22-worktree-separator.ps1 — index

Windows `\`-separator worktree smoke (test-plan X14). `git init` temp repo + `git worktree add .worktrees\feat-x`, GET `/api/git/worktrees?cwd=`, applies the client `inTree` predicate (normalise `\`→`/`, prefix-test) at the PROCESS level — no rendered-UI assert. Asserts the entry classifies in-tree and the default view does not collapse to the main row alone. Wired into `run-all.ps1`. See change: manage-worktrees-filter-cleanup.
