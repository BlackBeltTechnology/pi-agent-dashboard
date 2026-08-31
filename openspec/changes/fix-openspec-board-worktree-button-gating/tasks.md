## 1. Shared worktree-availability helper (TDD)

- [ ] 1.1 Create `packages/client/src/lib/git/folder-worktree-availability.ts` exporting `resolveWorktreeAvailability({ cwd, sessions, folderGitMap, gitWorktreeEnabled }): { available: boolean; reason?: "not-a-git-repo" | "worktrees-disabled" }`. Preference gate first (D3), then git state: non-null `folderGitMap` branch → git; else a session with `isGitRepo === false` → not git; else fail-open (D2). All folder matching via `pathKey` from `packages/shared/src/session-group-path.ts` (D5). Write the failing unit tests (tasks 2.x) before implementing.
- [ ] 1.2 Re-implement `folderIsGitRepo` in `packages/client/src/components/session/SessionList.tsx:274` as a delegation to the helper, keeping its exported signature. Verify `ManageWorktreesMenu.test.tsx` still passes unchanged.
- [ ] 1.3 Replace the inlined `showWorktree` gate at `packages/client/src/components/session/SessionList.tsx:1550` (`group.sessions.some((s) => s.isGitRepo !== false) && …`) with the helper, passing `folderGitMap` (D6). Verify `SessionList.card-spawn-worktree.test.tsx` still passes.

## 2. Helper unit tests (L1 — exemplar: `packages/client/src/lib/__tests__/auto-init-worktree.test.ts`)

New suite `packages/client/src/lib/__tests__/folder-worktree-availability.test.ts`. Each task below is one manifest row; verify each FAILS before 1.1 is implemented.

- [ ] 2.1 HEAD is positive evidence · `folderGitMap {"/repo":"develop"}` + session `{cwd:"/repo", isGitRepo:false}`, pref on · call helper · `{available:true}`, no reason (test-plan #E1)
- [ ] 2.2 Absent HEAD does not disable · `folderGitMap {"/repo":null}` + session `isGitRepo:undefined`, pref on · call helper · `{available:true}`, no reason (test-plan #E2)
- [ ] 2.3 Confirmed non-git · `folderGitMap {"/repo":null}` + session `isGitRepo:false`, pref on · call helper · `{available:false, reason:"not-a-git-repo"}` (test-plan #E3)
- [ ] 2.4 Unknown fails open · `folderGitMap {}` + sessions `[undefined, true]`, pref on · call helper · `{available:true}` (test-plan #E4)
- [ ] 2.5 Zero sessions fail open · `folderGitMap {}` + `sessions: []`, pref on · call helper · `{available:true}` (test-plan #E5)
- [ ] 2.6 Non-git via session only · `folderGitMap {}` + one session `isGitRepo:false`, pref on · call helper · `{available:false, reason:"not-a-git-repo"}` (test-plan #E6)
- [ ] 2.7 Preference outranks git state · `folderGitMap {"/repo":"develop"}` + `gitWorktreeEnabled:false` · call helper · `{available:false, reason:"worktrees-disabled"}` (test-plan #E7)
- [ ] 2.8 Reason precedence when both apply · session `isGitRepo:false` + `gitWorktreeEnabled:false` · call helper · `reason === "worktrees-disabled"` (test-plan #E8)
- [ ] 2.9 Unloaded preference reads as on · `gitWorktreeEnabled: undefined`, `folderGitMap {}`, `sessions: []` · call helper · `{available:true}`, no reason (test-plan #E9)
- [ ] 2.10 Path normalization · map key via `pathKey("/Users/x/Repo")`, query cwd `"/Users/x/Repo/"` (trailing slash + case variant on darwin) · call helper · resolves the entry → `{available:true}` where a raw `===` lookup would miss (test-plan #E10)
- [ ] 2.11 Liveness independence · session `{cwd:"/repo", status:"ended", gitBranch:undefined, isGitRepo:true}`, live sessions only under `/repo/.worktrees/x`, `folderGitMap {}` · call helper for `/repo` · `{available:true}`, identical to the same input with `status:"active"` (test-plan #E11)

## 3. Board + sidebar wiring

- [ ] 3.1 Change the `OpenSpecBoardView` prop from `isGitRepo: boolean` to `worktreeAvailability: { available: boolean; reason?: "not-a-git-repo" | "worktrees-disabled" }` (types at `OpenSpecBoardView.tsx:121` and `:1048`), threading it to `ProposalCard` and to the `NewProposalDialog` gate at `:613` (D4, decision 3). Verify `tsc` is clean.
- [ ] 3.2 In `packages/client/src/App.tsx` (~line 1712) replace the `sessions.some(s => s.cwd === boardCwd && !!s.gitBranch)` derivation with a `useMemo` over `resolveWorktreeAvailability`, passing the existing `folderGitMap` state (already held at `:558`) and `gitWorktreeEnabled`. Verify by grep that no `gitBranch` reference remains in the board prop block.
- [ ] 3.3 Render the `New worktree` button unconditionally in `ProposalCard` (`OpenSpecBoardView.tsx:~1117`) with `disabled` + muted styling + a `title` from the reason, replacing the `props.isGitRepo && props.gitWorktreeEnabled &&` conditional (D7). Verify `data-testid="card-new-worktree-<name>"` is present in both states.
- [ ] 3.4 Add the two i18n strings (`worktree.unavailableNotGitRepo` → "This folder is not a git repository", `worktree.unavailableDisabled` → "Worktrees are disabled in Settings") via `i18nT(key, undefined, fallback)`. Verify the i18n-coverage checks in `npm test` pass.

## 4. Board + sidebar behaviour tests (L1 RTL — exemplars: `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx`, `SessionList.worktree-per-change.test.tsx`)

- [ ] 4.1 Unavailable stays visible + explained · board with `worktreeAvailability:{available:false, reason:"not-a-git-repo"}`, change `add-dark-mode` · render · `card-new-worktree-add-dark-mode` in the DOM, `disabled`, `title` = "This folder is not a git repository" (test-plan #F1). Rewrites the existing absence assertion at `SessionList.worktree-per-change.test.tsx:97`.
- [ ] 4.2 Preference-off reason on every card · same view, `reason:"worktrees-disabled"`, three changes · render · all three buttons present + `disabled`, each `title` naming Settings (test-plan #F2). Rewrites the existing absence assertion at `SessionList.worktree-per-change.test.tsx:93`.
- [ ] 4.3 No wrong disabled flash on cold load · board rendered before `/api/config` resolves (`gitWorktreeEnabled` undefined), `folderGitMap {}` · render · worktree button enabled, no Settings reason in the card (test-plan #F3)
- [ ] 4.4 New-proposal dialog follows availability · `worktreeAvailability:{available:false, reason:"not-a-git-repo"}` · open the new-proposal dialog · no worktree option offered (test-plan #F4)
- [ ] 4.5 Sidebar agrees on a zero-session folder · `SessionList` with pinned `/repo`, `sessions: []`, `folderGitMap {"/repo":"develop"}`, pref on · render sidebar · `+ New Worktree` folder button is rendered (today hidden) (test-plan #F5)
- [ ] 4.6 Disabled action is inert · board card with `{available:false, reason:"not-a-git-repo"}` · click `card-new-worktree-<name>` · `onSpawnAttachedWorktree` not called, no dialog opens (test-plan #X3)
- [ ] 4.7 HEAD read failure must not disable · `folderGitMap {"/repo": null}` from a server-side probe throw, no session git state · call helper for `/repo` · `{available:true}`, never `reason:"not-a-git-repo"` (test-plan #X1). Add to the helper suite from group 2.
- [ ] 4.8 Stale negative cannot pin the button off · `folderGitMap {"/repo": null}` cached from before `git init`, session `{cwd:"/repo", isGitRepo:true}` · call helper · `{available:true}` (test-plan #X2). Add to the helper suite from group 2.
- [ ] 4.9 Update `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx:60` to the new prop shape. Verify the suite passes.

## 5. E2E regression (L3 — exemplar: `tests/e2e/manage-worktrees.spec.ts`)

- [ ] 5.1 Board availability survives all sessions ending · docker harness (`dashboardPort` read from `.pi-test-harness.json`, never hardcoded), git workspace with one main-cwd session + one worktree session, board open · end the main-cwd session out of band and let `session_removed` arrive · board converges with `card-new-worktree-*` still enabled on every card, never transitioning to disabled/absent (test-plan #F6)

## 6. Verification and landing

- [ ] 6.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm zero failures via the summary grep.
- [ ] 6.2 `npm run build && curl -X POST http://localhost:8000/api/restart`, then open the board for this repo with every main-cwd session ended and confirm `New worktree` is enabled; open a board for a non-git pinned folder and confirm the disabled button shows the not-a-git-repo reason.
- [ ] 6.3 Run `npm run quality:changed` (`code-quality` skill) and the `review-code` inline loop on the diff; resolve findings before commit.
- [ ] 6.4 Manual visual check: on a board for a non-git folder, confirm the muted `New worktree` button reads as intentionally disabled rather than as a broken or half-rendered control (test-plan #M1) (test-plan: manual-only)
- [ ] 6.5 Add the per-file rows for `packages/client/src/lib/git/folder-worktree-availability.ts` and its test in the nearest directory `AGENTS.md`, and append `See change: fix-openspec-board-worktree-button-gating` to the touched `App.tsx`, `OpenSpecBoardView.tsx`, `SessionList.tsx` rows. Verify with `kb dox lint`.
