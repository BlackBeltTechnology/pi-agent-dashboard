## 1. Config flag

- [x] 1.1 Add `gitWorktreeEnabled?: boolean` to `DashboardConfig` in `packages/shared/src/config.ts`; default `true` in `defaultConfig`.
- [x] 1.2 Round-trip test: omitted-on-disk → reads as `true`; explicit `false` → persists; toggle via partial-merge `/api/config` write preserves siblings.
- [x] 1.3 Surface the field in `SettingsPanel.tsx` as a checkbox under the existing git/workspace section. Label: "Show worktree spawn buttons in folders and OpenSpec rows". Help text clarifies preference-only semantics.

## 2. FolderActionBar gating

- [x] 2.1 Add `gitWorktreeEnabled: boolean` prop to `FolderActionBar` (required, no default — parent owns the config read).
- [x] 2.2 Extend `showWorktreeButton`: `isGitRepo === true && gitWorktreeEnabled && !!onOpenWorktreeDialog`.
- [x] 2.3 Extend `FolderActionBar.test.tsx` "+Worktree visibility" suite with arms: flag=false hides button even when repo is git; flag=true keeps current behavior; flag default-on when prop omitted (call sites supply via config).
- [x] 2.4 Wire `config.gitWorktreeEnabled ?? true` from `SessionList.tsx` into every `<FolderActionBar>` instance.

## 3. WorktreeSpawnDialog prop extensions

- [x] 3.1 Add `initialBranch?: string` prop. Use as initial state of the new-branch input. When omitted, behavior unchanged.
- [x] 3.2 Add `attachProposal?: string` prop (carried through, never displayed inside the dialog).
- [x] 3.3 Extend `onSpawn` signature to `(worktreePath: string, opts?: { gitWorktreeBase?: string; attachProposal?: string }) => void`. Always include `attachProposal` in `opts` when prop was supplied; never invent one.
- [x] 3.4 Component tests in `WorktreeSpawnDialog.test.tsx`:
  - `initialBranch="os/add-dark-mode"` renders that string in the branch input on first paint.
  - Submit flow with `attachProposal="add-dark-mode"` set → `onSpawn` called with `opts.attachProposal === "add-dark-mode"`.
  - Existing-worktree row click also forwards `attachProposal` when set.
  - No `attachProposal` prop → `opts.attachProposal` is `undefined` (backward-compat).

## 4. FolderOpenSpecSection — per-change ⑂+ button

- [x] 4.1 Add `onSpawnAttachedWorktree?: (cwd: string, changeName: string) => void` prop. When undefined, button hides (parity with `onSpawnAttached`).
- [x] 4.2 Add `gitWorktreeEnabled?: boolean` + `isGitRepo?: boolean` props (both default falsy-friendly). Button shows only when `isGitRepo && gitWorktreeEnabled && onSpawnAttachedWorktree`.
- [x] 4.3 Render `<Icon path={mdiSourceBranchPlus} size={0.5} />` button immediately to the left of the existing `▶` spawn-attached button. `data-testid="spawn-attached-worktree-btn-${c.name}"`. Tooltip: "New worktree for this change".
- [x] 4.4 Tests in `FolderOpenSpecSection.test.tsx`:
  - Button hidden when `isGitRepo` false even if flag on.
  - Button hidden when flag false even if repo is git.
  - Button hidden when handler undefined.
  - Click → handler called with `(cwd, changeName)`.
  - Existing `▶` spawn-attached row unchanged (regression guard).

## 5. SessionList wiring

- [x] 5.1 Read `config.gitWorktreeEnabled ?? true` once at the top of `SessionList`. Pass to every `FolderActionBar` and `FolderOpenSpecSection` instance.
- [x] 5.2 New state `worktreeForChange: { cwd: string; changeName: string } | null`.
- [x] 5.3 Pass `onSpawnAttachedWorktree={(cwd, changeName) => setWorktreeForChange({ cwd, changeName })}` into `FolderOpenSpecSection`.
- [x] 5.4 Render `WorktreeSpawnDialog` instance with `initialBranch={"os/" + worktreeForChange.changeName}` and `attachProposal={worktreeForChange.changeName}` when `worktreeForChange` is set. Reuse existing dialog instance pattern (do not duplicate the folder `+Worktree` dialog state).
- [x] 5.5 Dialog's `onSpawn` calls `onSpawnSession?.(path, undefined, opts)`. `opts` now includes `attachProposal` — confirm the existing `spawn_session` ws sender (line ~1046 area) forwards every key in `opts`. If it cherry-picks, add `attachProposal` to the forwarded set.
- [x] 5.6 End-to-end-ish integration test (jsdom): click `⑂+` on a change row → dialog opens with `os/<name>` prefill → submit creates worktree (mock POST) → spawn ws call carries `attachProposal` + `gitWorktreeBase`.

## 6. Orphan-path detection + cleanup

- [x] 6.1 Add pure helper `isOrphanWorktreePath({ path, worktreeList })` in `packages/server/src/git-worktree.ts` returning `boolean` (true when `existsSync(path) && !worktreeList.some(w => samePath(w.path, path))`). Unit tests: orphan dir, registered worktree path, non-existent path, case/separator variants on macOS/Windows.
- [x] 6.2 Add `orphanCleanup(path)` to `packages/server/src/git-operations.ts`. Refuse with stable error codes when: `.git` entry exists at path (`looks_like_worktree`), file count > 20 (`too_many_files`), any file > 1 MB (`file_too_large`), path is not under repo root (`outside_repo`). On pass: `fs.rm({ recursive: true, force: true })`. Unit tests: every refuse arm + happy path.
- [x] 6.3 Extend `addWorktree`'s `path_exists` error envelope to include `orphanLikely: boolean` derived from `isOrphanWorktreePath`. Update existing tests.
- [x] 6.4 Register `POST /api/git/worktree/orphan-cleanup` in `packages/server/src/routes/git-routes.ts`. Localhost-gated. Body `{ cwd, path }`. Returns `{ ok: true }` on success or `{ ok: false, code, message }` on refuse. HTTP 200 / 409 / 400 per code.
- [x] 6.5 Route integration tests: every refuse code + happy path + envelope shape.
- [x] 6.6 Add `cleanupOrphanWorktreePath({ cwd, path })` fetch helper to `packages/client/src/lib/git-api.ts`.
- [x] 6.7 In `WorktreeSpawnDialog`: when user fills branch name and derived path preview matches an existing-on-disk path that is NOT in the worktree list, render inline warning row + `[Clean up]` button. Detection runs as a debounced effect on `derivedPath` change; uses existing worktree list (already fetched) + a new lightweight `HEAD /api/files/exists?path=` probe OR repurpose existing browse endpoint — verify cheapest path during implementation.
- [x] 6.8 Submit-failure path: when `POST /api/git/worktree` returns `path_exists` with `orphanLikely: true`, surface the same warning + Clean-up button inline below the error. After successful cleanup, auto-retry submit ONCE.
- [x] 6.9 Component tests in `WorktreeSpawnDialog.test.tsx`:
  - derivedPath collides with orphan → warning visible, submit disabled
  - Clean-up click → calls API → warning collapses → submit re-enables
  - submit returns `path_exists + orphanLikely:true` → same warning+button below error
  - submit returns `path_exists + orphanLikely:false` (registered worktree) → plain error, NO clean-up button

## 7. Docs

- [x] 6.1 Add `docs/file-index-client.md` rows (caveman style, delegated subagent) for the new prop contracts on `WorktreeSpawnDialog` and `FolderOpenSpecSection`.
- [x] 6.2 Add `docs/file-index-shared.md` (or relevant split) row noting `gitWorktreeEnabled` config field default + semantics.
- [x] 6.3 No `docs/architecture.md` change — no new dataflow.

## 9. Node engines-range startup guard (post-archive addition)

Single actionable startup-time error mirroring `package.json#engines.node` (`>=22.19.0 <26`). Added after the original archive in commit `63a8d531`; cap subsequently bumped from `<25` to `<26` to restore Node 25 support (CI matrix had been running it cleanly all along; the dev-reported EBADENGINE was an nvm subprocess-PATH artifact, not a real engines failure).

- [x] 9.1 Add `isOutOfEnginesRange(version: string): boolean` pure predicate in `packages/server/src/node-guard.ts` returning `true` for major `<22`, major `22` with minor `<19`, or major `>=26`.
- [x] 9.2 Add `buildEnginesRangeMessage(version)` containing three remediation hints (nvm / bundled `$HOME/.pi-dashboard/node/bin` PATH prepend / brew) and the substring `Required: >=22.19.0 <26`.
- [x] 9.3 Extend `assertNodeVersionSupported()` to call `isOutOfEnginesRange` after the existing `isAffectedNode` check; on hit, write message to stderr and `process.exit(1)`.
- [x] 9.4 Allowlist `packages/server/src/node-guard.ts` in `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` (advisory help-text only, no read/write of `~/.pi-dashboard/`). Rationale comment cites this change.
- [x] 9.5 Bump `package.json#engines.node` from `>=22.19.0 <25` to `>=22.19.0 <26`. Restores Node 25 in `.github/workflows/ci.yml` `standalone-install-smoke-linux` (`node:25-bookworm-slim` + `node:25-alpine`) and `standalone-install-smoke-windows` (`node-version: [22, 24, 25]`).
- [x] 9.6 Tests in `packages/server/src/__tests__/node-guard.test.ts`: predicate covers each arm (major <22, 22.18 / 22.19 boundary, 24.x, 25.x allowed, 26.0 refused); `buildEnginesRangeMessage` includes the three remediation substrings + `>=22.19.0 <26`.
- [ ] 9.7 Lockstep audit: if `package.json#engines.node` is changed in a follow-up PR, the upper arm of `isOutOfEnginesRange` and the CI matrices MUST move with it. Called out in `proposal.md` Impact.

## 8. Verification

- [x] 8.1 `npm test` all green.
- [x] 8.2 Manual: in dev mode, toggle the setting in Settings UI, confirm `+Worktree` and `⑂+` show/hide together.
- [x] 8.3 Manual: create a worktree via the per-change button, verify resulting session has both `gitWorktree` set AND `attachedProposal` resolved.
- [x] 8.4 Manual: confirm old session-card path (folder `+Worktree` without attachment) still works — i.e. omitting `attachProposal` is fully backward-compat.
- [ ] 8.5 Manual orphan-recovery: reproduce the bug (create dir manually at `.worktrees/<name>` with 1-2 stray files), open dialog, type branch name matching the orphan — verify inline warning + Clean-up button appears, click cleans up, submit succeeds.
- [ ] 8.6 Manual refuse-arm: orphan dir contains a `.git` file — verify Clean-up refuses with `looks_like_worktree` and surfaces a manual-fix hint.
