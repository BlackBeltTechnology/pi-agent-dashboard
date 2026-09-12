# git.ts

Recipe-based git API. Thin wrappers over `run()` / `runAsync()` (runner.ts). No `child_process`, no `process.platform`, no shell-escape logic here.

## Recipes (`Recipe` consts)

`GIT_IS_REPO`, `GIT_CURRENT_BRANCH`, `GIT_HEAD_SHA`, `GIT_REMOTE_URL`, `GIT_COMMON_DIR`, `GIT_TOPLEVEL`, `GIT_DIFF`, `GIT_STATUS_PORCELAIN`, `GIT_STATUS_V2`, `GIT_NUMSTAT` (`git diff --numstat --relative HEAD`), `GIT_DIFF_ALL` (batched `git diff --relative HEAD`, no path arg), `GH_PR_NUMBER`. Enumerated by `GIT_RECIPES`.

## Typed funcs

`isGitRepo` / `currentBranch` / `headSha` / `remoteUrl` / `commonDir` / `toplevel` / `diff` / `statusPorcelain` / `gitStatusV2` / `numstat` / `prNumber` → `Result<T>`. `*Or` variants swallow errors → fallback.

## Async (`runAsync`) variants — hot request paths, no `spawnSync`

`diffAll` / `diffAllOr` (batched whole-worktree diff; callers split per file on `diff --git` header boundaries), `isGitRepoOrAsync`, `statusPorcelainOrAsync`, `numstatOrAsync`, `headShaOrAsync`. Used by `/api/session-diff` so no synchronous git blocks the event loop. See change: fix-session-diff-eventloop-block.

## Checkout-root resolution

`GitCheckoutRoots` = `{thisCheckout, isLinkedWorktree, mainCheckout, commonDir}`. Four fields, never one path. Replaces `dirname(--git-common-dir)`, wrong whenever git dir sits outside its checkout (submodule, worktree-of-submodule, `--separate-git-dir`, bare, worktree-of-bare).

`resolveCheckoutRootsFrom(probes, platform?)` — pure, injected thunks. `checkoutRoots({cwd, timeout?})` — canonical wiring over the recipes; every consumer SHOULD use it.

Required probes `GIT_DIR_ABS` + `GIT_COMMON_DIR_ABS`, both `--path-format=absolute`. Absolute form is CONTRACT: `isLinkedWorktree` is an equality test, mixed forms make every normal checkout report as a worktree. Either fails → `null` (no result). `GIT_TOPLEVEL` NOT required — fails by design in a bare repo → `thisCheckout: null` with a RESULT, so bare stays distinguishable from non-repo.

`isLinkedWorktree` = `--git-dir` ≠ `--git-common-dir` (via `samePath`). NOT common-dir-outside-toplevel (calls a submodule a worktree), NOT `basename(commonDir) === ".git"` (calls a worktree-of-submodule and worktree-of-bare non-worktrees).

`mainCheckout`: not-worktree → `thisCheckout`; else `GIT_CONFIG_LOCAL_CORE_WORKTREE` resolved against commonDir (`--local`, argv — a merged read leaks `~/.gitconfig` into an authorization anchor); else `dirname(commonDir)` when named `.git` AND `GIT_CONFIG_LOCAL_CORE_BARE` CONFIRMS not-bare (a bare hub may itself be named `.git`; its parent owns no checkout); else `null`. Bareness probe is `--type=bool` (git accepts `yes`/`on`/`1`) and THREE-valued `GitBareness = "not-bare"|"bare"|"unknown"` — spawn failure/timeout is `unknown`, never `not-bare`, so an unread probe cannot re-open the fallback; unset = `not-bare` (git's boolean default).

Returned VERBATIM. `core.worktree` is user-controlled and git does not validate it — CONSUMERS validate. `hasGitPathSegment(p, platform?)` = exact path-COMPONENT equality (`/work/app.git` is not rejected).

Fixtures: `test-support/git-fixtures.ts`. Tests: `__tests__/git-checkout-roots.test.ts`. See changes: add-git-checkout-root-resolver, widen-containment-to-resolved-checkout.

`commonDir` = canonical absolute `--git-common-dir`. Repository IDENTITY. NEVER a trust anchor / containment root / admission path. Exists so consumers bind without re-probing cwd.

Async: `resolveCheckoutRootsFromAsync(probes, platform?)` + `checkoutRootsAsync({cwd, timeout?})`. Same pure core, `runAsync` probes. Phases resolve probe VALUES only; gating uses the SAME `isLinked` / `wantsBareness` predicates as the sync core, so wirings cannot drift. Un-run thunk throws → core maps to `"unknown"`. Use on event-loop-sensitive routes.

Binding: `isBoundCheckout(candidate, commonDir, {timeout?})`, `isBoundCheckoutAsync` (same), pure core `isBoundCheckoutFromRoots(candidate, commonDir, roots, platform?)`. Candidate realpath'd, then re-resolved. Bound iff no `.git` segment AND candidate NOT under `commonDir` AND re-resolved `commonDir` samePath AND re-resolved `thisCheckout` samePath candidate. Fail closed: nonexistent / not-a-repo / different repo / probe failure-timeout → false. Shared by file-read containment + kb cwd guard, so "the repository owns this path" has ONE definition. See change: widen-containment-to-resolved-checkout.

## Parser

`parseGitStatusV2(stdout)` → `GitStatus` (pure). Parses `git status --porcelain=v2 --branch`: `1`/`2`/`u`/`?` lines + `# branch.ab`. Reused by bridge broadcast AND server `getGitStatus`. See changes: add-change-summary-table, add-session-uncommitted-indicator-and-commit.
