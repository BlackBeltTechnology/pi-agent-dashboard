# repo-hygiene

Repo-level ignore rules that keep local-only working directories (git worktrees, build outputs, caches) out of git.

## Requirements

### Requirement: Repo MUST ignore git worktree directories

The repo-root `.gitignore` SHALL list `.worktrees/` so that git worktree clones created via `git worktree add` under `.worktrees/<name>/` are excluded from `git status`, `git add`, and `git commit` from the main worktree.

#### Scenario: Workspace exists, status is clean

- **WHEN** a contributor has one or more `git worktree add` targets under `.worktrees/<name>/` and runs `git status` in the main worktree
- **THEN** no `.worktrees/...` paths appear in the output

#### Scenario: Bulk add does not stage worktree files

- **WHEN** a contributor runs `git add .` from the repo root with `.worktrees/<name>/` populated
- **THEN** no files under `.worktrees/` are added to the git index
