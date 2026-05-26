## 1. Pure helpers (no I/O)

- [x] 1.1 Create `packages/server/src/git-worktree-lifecycle.ts` with stderr→`code` mappers for each of the four operations; export `mapRemoveStderr`, `mapMergeStderr`, `mapPushStderr`, `mapPrStderr`.
- [x] 1.2 Create `packages/server/src/active-sessions-in-cwd.ts` with pure `activeSessionsUnder(path, sessions)` returning `SessionId[]` for sessions whose `cwd` is `path` or a descendant; path-prefix match with case-folding on Win/macOS via shared platform helpers.
- [x] 1.3 Unit tests for each: 6+ stderr arms per mapper (8 cases total per op covering happy + every documented code), 5 cases for `activeSessionsUnder` (exact, descendant, sibling, ended-excluded, empty).

## 2. Shared types + protocol

- [x] 2.1 Add `cwdMissing?: boolean` to `DashboardSession` in `packages/shared/src/types.ts`. JSDoc cites this change.
- [x] 2.2 Add `CwdMissingMessage` (`{ type: "cwd_missing"; sessionId: string }`) to `packages/shared/src/protocol.ts` extension→server union.
- [x] 2.3 Round-trip serialization test.

## 3. Bridge cwd probe

- [x] 3.1 Extend the 30 s VCS tick in `packages/extension/src/model-tracker.ts` to call `existsSync(ctx.cwd)`. Cache last result on `BridgeContext.lastCwdMissing`; emit `cwd_missing` on flip (true → undefined transitions don't fire, since when cwd reappears it's almost certainly a new dir).
- [x] 3.2 4 unit tests: probe-true-on-deleted, probe-false-on-exists, debounce-no-flip, no-spam-on-stable.

## 4. Server endpoints — remove

- [x] 4.1 Add `removeWorktree({ cwd, force })` to `packages/server/src/git-operations.ts`. Resolves parent repo via `--git-common-dir`; runs `git worktree remove [--force] <cwd>` from parent; maps stderr.
- [x] 4.2 Pre-flight: call `activeSessionsUnder(cwd, sessionManager.list())`. If non-empty AND `force !== true`, return `{ ok: false, code: "active_sessions", sessionIds }`.
- [x] 4.3 Optimistic stamp: on success, call `sessionManager.update` with `cwdMissing: true` for every active session under the path (broadcast via existing `broadcastSessionUpdated`).
- [x] 4.4 Register `POST /api/git/worktree/remove` in `git-routes.ts` (localhost-only, validateCwd).
- [x] 4.5 8 unit + 6 route tests covering every documented code + cross-worktree parent-resolve.

## 5. Server endpoints — merge

- [x] 5.1 Add `mergeWorktree({ cwd, deleteBranch })` to `git-operations.ts`. Reads worktree's branch via `--abbrev-ref HEAD`, reads base from `session.gitWorktreeBase` if known, falls back to `develop`/`main`/`master` via existing `resolveDefaultBase`.
- [x] 5.2 Pre-flight: `git -C <mainPath> status --porcelain` empty → ok. Otherwise return `dirty_main`.
- [x] 5.3 Run `git -C <mainPath> checkout <base>`, then `git merge --no-ff <branch>`. On conflict, abort the merge and return `merge_conflict` with stderr.
- [x] 5.4 If `deleteBranch`, run `git -C <mainPath> branch -d <branch>` (no `-D` — we already merged, refusing means something is wrong).
- [x] 5.5 Register `POST /api/git/worktree/merge` in `git-routes.ts`.
- [x] 5.6 Add `GET /api/git/worktree/diff-stat?cwd=<path>` returning the 5-line `git diff --stat <base>..<branch>` for the merge confirm dialog.
- [x] 5.7 9 unit + 7 route tests.

## 6. Server endpoints — push + PR

- [x] 6.1 Add `pushBranch({ cwd, setUpstream })` to `git-operations.ts`. Runs `git push -u origin <branch>` from cwd; maps `no_remote`, `auth_failed`, `non_fast_forward`.
- [x] 6.2 Add `createPullRequest({ cwd, title, body })` to `git-operations.ts`. Probes upstream via `rev-parse --abbrev-ref <branch>@{upstream}`. Missing → call `pushBranch` first (return `pushed_but_pr_failed` if PR step fails after a successful push). Runs `gh pr create --base <base> --head <branch> [--title --body]`; parses URL from stdout.
- [x] 6.3 Register `POST /api/git/worktree/push` and `POST /api/git/worktree/pr` in `git-routes.ts`.
- [x] 6.4 6 + 9 unit tests; 5 + 7 route tests.

## 7. Server cwd-loss handling

- [x] 7.1 Wire `cwd_missing` handler in `event-wiring.ts`: `sessionManager.update(sessionId, { cwdMissing: true })` + `broadcastSessionUpdated`.
- [x] 7.2 Extend `session-scanner.ts` boot pass: for each ended session, run `existsSync(s.cwd)` and stamp `cwdMissing` on the session object before adding it to the manager.
- [x] 7.3 Rename error code `cwd_invalid` to `cwd_missing` in `spawn-preflight.ts`. Keep the old code as an alias (server returns `code: "cwd_missing"`; older clients reading `cwd_invalid` continue to work because we include both in the response envelope's `error` field for one release).
- [x] 7.4 3 scanner tests + 1 spawn-preflight test.

## 8. Client — actions menu + dialogs

- [x] 8.1 Create `WorktreeActionsMenu.tsx` rendered in WORKSPACE subcard when `session.gitWorktree`. Four icon buttons: Push (`mdiArrowUpBoldOutline`), Open PR / View PR (`mdiSourcePull`), Merge (`mdiSourceMerge`), Close worktree (`mdiCloseBoxOutline`). Open PR toggles to "View PR" link when `session.gitPrNumber != null`.
- [x] 8.2 Create `CloseWorktreeDialog.tsx`: shows active sessions list (from a fresh fetch since the user could've spawned more), `Delete merged branch` checkbox (auto-detected via a `branch-merged-into-base` probe), `--force` toggle.
- [x] 8.3 Create `MergeConfirmDialog.tsx`: fetches `/api/git/worktree/diff-stat`, shows 5-line summary, `Delete branch after merge` checkbox. Surfaces conflict-stderr in a collapsed `<details>`.
- [x] 8.4 Create `CwdGonePill.tsx`: small red pill, rendered next to `WorktreePill` when `session.cwdMissing`.
- [x] 8.5 Disable resume button + add tooltip on cards with `cwdMissing`.
- [x] 8.6 16 component tests across the four files.

## 9. Folder action bar — broken cleanup

- [x] 9.1 Add `Clean up broken (N)` button to `FolderActionBar.tsx`. `N` = count of ended sessions in the folder with `cwdMissing: true`. Hidden when N === 0.
- [x] 9.2 Click → confirm dialog → bulk-hide via existing `hidden` mechanism (one `hide` message per session).
- [x] 9.3 4 component tests.

## 10. Mobile

- [x] 10.1 `WorktreeActionsMenu` mobile branch: collapses to a `⋯` button opening an action sheet. Mirror `JjActionBar` mobile pattern.
- [x] 10.2 3 mobile-vs-desktop component tests.

## 11. Documentation

- [x] 11.1 Add rows to `docs/file-index-server.md` for `git-worktree-lifecycle.ts`, `active-sessions-in-cwd.ts` (caveman style).
- [x] 11.2 Add rows to `docs/file-index-client.md` for the three new dialogs + `WorktreeActionsMenu` + `CwdGonePill`.
- [x] 11.3 Update existing rows for `git-operations.ts`, `git-routes.ts`, `vcs-info.ts`, `model-tracker.ts`, `event-wiring.ts`, `session-scanner.ts`, `spawn-preflight.ts`, `SessionCard.tsx`, `FolderActionBar.tsx`.
- [x] 11.4 Mention worktree lifecycle in `docs/architecture.md` (one short paragraph alongside the existing `.worktrees/` paragraph from `add-worktree-spawn-dialog`).

## 12. Validation

- [x] 12.1 Run `openspec validate add-worktree-lifecycle-actions --strict`.
- [x] 12.2 Run full test suite — no regressions. (6293/6294 pass; 1 pre-existing flake in chat-input-images-integration, unrelated; passes in isolation.)
- [ ] 12.3 Manual smoke test:
  - Spawn worktree session → push → open PR (verify URL in card) → merge (verify diff-stat dialog) → close (verify session-end + branch-delete checkbox).
  - External `rm -rf .worktrees/test/` → wait 30 s → verify `cwdMissing` pill appears on card → click `Clean up broken` → verify session hidden.
- [ ] 12.4 Cross-platform smoke on Windows (path separators in active-sessions-under match; `gh` resolution).
