# git.ts

Recipe-based git API. Thin wrappers over `run()` / `runAsync()` (runner.ts). No `child_process`, no `process.platform`, no shell-escape logic here.

## Recipes (`Recipe` consts)

`GIT_IS_REPO`, `GIT_CURRENT_BRANCH`, `GIT_HEAD_SHA`, `GIT_REMOTE_URL`, `GIT_COMMON_DIR`, `GIT_TOPLEVEL`, `GIT_DIFF`, `GIT_STATUS_PORCELAIN`, `GIT_STATUS_V2`, `GIT_NUMSTAT` (`git diff --numstat --relative HEAD`), `GIT_DIFF_ALL` (batched `git diff --relative HEAD`, no path arg), `GH_PR_NUMBER`. Enumerated by `GIT_RECIPES`.

## Typed funcs

`isGitRepo` / `currentBranch` / `headSha` / `remoteUrl` / `commonDir` / `toplevel` / `diff` / `statusPorcelain` / `gitStatusV2` / `numstat` / `prNumber` → `Result<T>`. `*Or` variants swallow errors → fallback.

## Async (`runAsync`) variants — hot request paths, no `spawnSync`

`diffAll` / `diffAllOr` (batched whole-worktree diff; callers split per file on `diff --git` header boundaries), `isGitRepoOrAsync`, `statusPorcelainOrAsync`, `numstatOrAsync`, `headShaOrAsync`. Used by `/api/session-diff` so no synchronous git blocks the event loop. See change: fix-session-diff-eventloop-block.

## Parser

`parseGitStatusV2(stdout)` → `GitStatus` (pure). Parses `git status --porcelain=v2 --branch`: `1`/`2`/`u`/`?` lines + `# branch.ab`. Reused by bridge broadcast AND server `getGitStatus`. See changes: add-change-summary-table, add-session-uncommitted-indicator-and-commit.
