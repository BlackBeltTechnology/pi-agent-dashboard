## 1. Fix worktree session ordering (groupCwd)

- [x] 1.1 In `event-wiring.ts`, after worktree detection sets `groupCwd`, insert session into `groupCwd` order and move to front: `sessionOrderManager.insert(groupCwd, sessionId)` + `sessionOrderManager.moveToFront(groupCwd, sessionId)`
- [x] 1.2 Change `sessions_reordered` broadcast to use `groupCwd` as the cwd key when `groupCwd` is set
- [x] 1.3 Update `session-ordering` unit tests: verify worktree session is prepended to groupCwd order, not worktree cwd order
- [x] 1.4 Update `event-wiring` tests: verify `sessions_reordered` is broadcast with `cwd: groupCwd` for worktree sessions

## 2. Placeholder in-place replacement verification

- [x] 2.1 Verify client-side `session_added` handler already removes placeholder (existing behavior) — confirm no client changes needed
- [x] 2.2 Update `PlaceholderSessionCard.test.tsx` / `SessionList.test.tsx`: verify placeholder removal and real card at top position when `sessions_reordered` arrives with session at index 0

## 3. Worktree cleanup on archive

- [x] 3.1 Add `findMatchingWorktrees(repoRoot, changeName)` helper to `worktree-manager.ts` — matches worktrees under `.pi/worktrees/<changeName>-*` using exact path prefix match
- [x] 3.2 Add optional `cleanupWorktree?: boolean` to `POST /api/openspec/archive` body in `openspec-routes.ts`
- [x] 3.3 After successful archive, if `cleanupWorktree` is true, call `findMatchingWorktrees` and `removeWorktree` for each match
- [x] 3.4 Archive response includes `{ success, cleanedUpWorktrees, cleanupErrors }` when `cleanupWorktree` is true; fields absent when flag is false
- [x] 3.5 Add "Remove associated worktree" checkbox to `ArchiveBrowserView.tsx` — visible when `GET /api/git/worktrees?cwd=...` returns non-empty list for the current cwd
- [x] 3.6 Wire checkbox to `cleanupWorktree` parameter in archive API call
- [x] 3.7 Update `worktree-manager.test.ts`: test `findMatchingWorktrees` exact-prefix matching, no-match, multi-match, partial-prefix mismatch
- [x] 3.8 Update archive endpoint tests: cleanup success, cleanup failure doesn't block archive, missing flag

## 4. Browser test

- [x] 4.1 Create `qa/worktree-placeholder/` directory with Dockerfile (node:22, git, chromium deps)
- [x] 4.2 Create `qa/worktree-placeholder/worktree-placeholder.test.mjs` — Playwright test:
  - Create temp git repo with a branch
  - Start dashboard server
  - Click "Worktree" button, fill branch name, submit
  - Assert placeholder appears at top of group (data-testid)
  - Wait for real session card to appear at top position
  - Assert placeholder is gone
  - Assert session card is at top (first child of group list)
- [x] 4.3 Create `qa/worktree-placeholder/test-runner.sh` — Docker build + run orchestration
- [x] 4.4 Add test to CI or document manual run command

## 5. Final verification

- [x] 5.1 `npm test` passes all existing and new tests
- [x] 5.2 Manual smoke test: spawn worktree session, verify card appears at top replacing placeholder
- [x] 5.3 Manual smoke test: spawn two worktree sessions sequentially, verify both replace placeholders, order is C, B, A
