## 1. Worktree Manager Module

- [x] 1.1 Create `packages/server/src/worktree-manager.ts` with `addWorktree(repoRoot, branch)` using `git worktree add`
- [x] 1.2 Add `listWorktrees(repoRoot)` using `git worktree list --porcelain`
- [x] 1.3 Add `removeWorktree(repoRoot, path)` using `git worktree remove --force`
- [x] 1.4 Handle errors: dirty working tree, branch not found, not a git repo, path exists
- [x] 1.5 Create `.pi-worktrees/` directory and add to `.gitignore` on first worktree creation
- [x] 1.6 Write unit tests for `worktree-manager.ts`

## 2. API Endpoints

- [x] 2.1 Add `GET /api/git/worktrees?cwd=<path>` route returning list of worktrees
- [x] 2.2 Add `DELETE /api/git/worktrees` route for worktree removal
- [x] 2.3 Add `spawnMode: "worktree"` and `branch` fields to spawn request handling in session routes
- [x] 2.4 Wire worktree pre-spawn hook into spawn flow: create worktree → spawn pi in it
- [x] 2.5 Add validation: reject if `cwd` is not in a git repo, branch missing, etc.

## 3. Process Manager Changes

- [x] 3.1 Add `preSpawnHook` parameter to `spawnPiSession` options
- [x] 3.2 Invoke hook before process creation; use returned path as spawn `cwd`
- [x] 3.3 Ensure hook failure produces clean `SpawnResult` with error, no orphaned process
- [x] 3.4 Update type definitions for `SpawnOptions` (new fields, backward compatible)
- [x] 3.5 Write unit tests for pre-spawn hook behavior

## 4. Worktree Detection on Session Register

- [x] 4.1 Detect worktree on `session_register`: check if `.git` is a file (not directory) in `cwd`
- [x] 4.2 Extract branch name via `git branch --show-current` in worktree path
- [x] 4.3 Populate `DashboardSession.worktree` field: `{ branch, path }`
- [x] 4.4 Include `worktree` in `session_updated` broadcasts and `sessions_snapshot`
- [x] 4.5 Update shared types (`DashboardSession`) with optional `worktree` field

## 5. Worktree Spawn Dialog (Mobile-Friendly)

- [x] 5.1 Create `WorktreeSpawnDialog` component with full-screen sheet on mobile (<768px)
- [x] 5.2 Integrate existing `BranchPicker` for branch selection with typeahead
- [x] 5.3 Add optional worktree label input field
- [x] 5.4 Add "Spawn in worktree" primary button; wire to `POST /api/sessions/spawn` with `spawnMode: "worktree"`
- [x] 5.5 Handle spawn errors: show inline error for dirty tree, branch not found, etc.
- [x] 5.6 Add 44px minimum touch targets and large font sizes for mobile
- [x] 5.7 Close dialog on successful spawn; show new session in list

## 6. Session Card Worktree Indicator

- [x] 6.1 Add worktree branch indicator to `SessionCard` when `session.worktree` is set
- [x] 6.2 Render branch name as a pill/badge next to cwd path
- [x] 6.3 Add worktree icon (from MDI via `mdi-icon-lookup`)
- [x] 6.4 Add tooltip showing full worktree path on hover

## 7. Integration & Polish

- [x] 7.1 Add spawn-in-worktree entry point in session list (button next to existing spawn)
- [x] 7.2 Ensure worktree sessions appear in correct directory group
- [x] 7.3 Test full flow: select branch → create worktree → spawn session → verify isolation
- [x] 7.4 Test on mobile viewport (375px wide) — dialog usability, touch targets
- [x] 7.5 Test error cases: dirty tree, invalid branch, git unavailable, duplicate spawn
