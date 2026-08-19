## 1. Server — `deleteBranch` on remove

- [x] 1.1 Author the branch-delete outcome tests in `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts` (see that file's existing `removeWorktree` temp-repo cases for harness glue). Triple: a worktree whose branch is merged into its base, and one whose branch is unmerged · `removeWorktree({ deleteBranch: true })` on each · merged → removed with `branchDeleted: true` and the branch gone; unmerged → still removed, `branchDeleted: false`, `branchDeleteCode: "unmerged"`, branch still exists (test-plan #E16)
- [x] 1.2 Author the null-branch skip test in `git-worktree-lifecycle-ops.test.ts` (see the existing porcelain-parser cases for fixture shape). Triple: entries `{detached: true, branch: null}` and `{bare: true, branch: null}` · `removeWorktree({ deleteBranch: true })` · `branchDeleted: false`, `branchDeleteCode: "no_branch"`, and `git branch` never invoked — assert on the command spy, not the outcome (test-plan #E8). Do NOT author a `bare` *removal* test: `git worktree add` has no `--bare` and a porcelain `bare` entry is only ever a bare repo's own main entry, which `git worktree remove` refuses
- [x] 1.3 Author the code-disjointness test in `packages/server/src/__tests__/git-worktree-lifecycle.test.ts` (see its existing `mapRemoveStderr` table tests). Triple: the `BranchDeleteCode` and `RemoveCode` unions · evaluate set intersection · intersection is empty, with `"git_failed"` in `RemoveCode` only (test-plan #E7)
- [x] 1.4 Author the no-force-retry test in `packages/server/src/__tests__/git-worktree-lifecycle-routes.test.ts` (see its existing 409-mapping cases). Triple: unmerged branch removed with `deleteBranch: true` · removal succeeds, branch delete refused · HTTP 200 carrying `branchDeleted: false` + `branchDeleteCode: "unmerged"`, and NOT a `RemoveCode` of `branch_not_merged`, so a client keyed on `RemoveCode` does not auto-tick `--force` (test-plan #X4)
- [x] 1.5 Author the single-endpoint main-worktree rejection test in `git-worktree-lifecycle-routes.test.ts` (see its existing `validateCwd` rejection cases). Triple: the main worktree's own path · `POST /api/git/worktree/remove` · failure carrying `is_main_worktree`, no `git worktree remove` runs, status is not 500 (test-plan #E14)
- [x] 1.6 Author the abandoned-caller test in `git-worktree-lifecycle-routes.test.ts`. Triple: client disconnects after `git worktree remove` succeeds but before the response is written, with `deleteBranch: true` · abort the request mid-handler · C2 resolved: no compensation — the branch delete happens anyway; assert the deletion completed and no unhandled rejection escapes (test-plan #X6)
- [x] 1.7 Extend `removeWorktree()` in `packages/server/src/git-worktree/git-operations.ts` with `deleteBranch?: boolean`, running `git branch -d <branch>` in the resolved main worktree after a successful removal (never `-D`, per design D5), skipping when `branch == null`. Capture the branch name **before** the removal — `removeWorktree` does not read it today and it is unrecoverable once the worktree is gone
- [x] 1.8 Define `BranchDeleteCode = "deleted" | "unmerged" | "no_branch" | "branch_gone" | "delete_failed"` in a namespace disjoint from `RemoveCode` — the generic failure is `delete_failed`, NOT `git_failed`, which is already a `RemoveCode` value; and it must never reuse `branch_not_merged`, which means "removal failed" and makes `CloseWorktreeDialog.tsx:60` auto-tick `--force` and retry
- [x] 1.9 Widen the success payload to `{ removed: true; branchDeleted: boolean; branchDeleteCode?: BranchDeleteCode }` and thread `deleteBranch` through `POST /api/git/worktree/remove` in `packages/server/src/routes/git-routes.ts`
- [x] 1.10 Add the `is_main_worktree` rejection to the single `remove` endpoint — it has no `isMain` guard today, so removing the main worktree maps to `git_failed` → 500 rather than a clean rejection
- [x] 1.11 Verify tasks 1.1–1.5 pass and every existing `remove` test still passes with `deleteBranch` absent (default behaviour unchanged)

## 2. Server — `remove-batch` endpoint

- [x] 2.1 Author the partial-failure test in `packages/server/src/__tests__/git-worktree-lifecycle-routes.test.ts` (see its existing multi-worktree temp-repo setup). Triple: a 3-item batch where item 2 has uncommitted changes · `POST /api/git/worktree/remove-batch` without force · 3 results in input order, items 1+3 `ok` and gone from disk, item 2 `dirty_worktree` and still on disk (test-plan #X1)
- [x] 2.2 Author the blocked-item test in the same file (see the single endpoint's `active_sessions` 409 case for the session-manager stub). Triple: item 2 has 2 active sessions under its path · batch post without force for that item · item 2 reports `active_sessions` with its own `sessionIds`, items 1+3 still process (test-plan #X2)
- [x] 2.3 Author the per-item containment test in the same file. Triple: a batch where item 2's `cwd` fails `validateCwd` or resolves outside the main worktree · batch post · item 2 rejected with the validation code, items 1+3 still process, nothing outside the repo touched (test-plan #X10)
- [x] 2.4 Author the cwdMissing-broadcast test in the same file, asserting against the browser-gateway spy the single-endpoint tests already use. Triple: a successfully removed batch item with 2 sessions registered under its path · batch post succeeds for that item · both sessions updated with `cwdMissing: true` and one `sessionUpdated` broadcast emitted per session (test-plan #X3)
- [x] 2.5 Author the body-validation test in the same file. Triple: bodies `{}`, `{items: null}`, `{items: "abc"}`, `{items: {}}` · `POST /api/git/worktree/remove-batch` · each returns 400 with the stable validation code and zero git commands execute (test-plan #E11)
- [x] 2.6 Author the cap lower-boundary test in the same file. Triple: batch arrays of length 0 and 1 · batch post · length 0 accepted with `results: []` and no git invoked; length 1 processed normally (test-plan #E5)
- [x] 2.7 Author the cap upper-boundary test in the same file. Triple: batch arrays of length 50 and 51 · batch post · 50 processed returning 50 results; 51 returns 400 with the stable cap code and zero git commands execute (test-plan #E6)
- [x] 2.8 Register `POST /api/git/worktree/remove-batch` with the `networkGuard` preHandler, applying `validateCwd` + main-worktree resolution per item, never aborting on first failure (design D4)
- [x] 2.9 Widen the item result to `code: RemoveCode | "active_sessions" | "cwd_invalid" | "is_main_worktree"` plus `sessionIds?: string[]` on the `active_sessions` case — `active_sessions` is a route-level 409 and is not a `RemoveCode` member, so without this the per-row escalation is unimplementable
- [x] 2.10 Implement the `cwdMissing` stamp + broadcast per successful item, extracting the block shared with the single endpoint (`git-routes.ts:641-648`) rather than duplicating it
- [x] 2.11 Enforce the batch item cap (50) before any git invocation; server-side guard only — do NOT mirror the constant client-side
- [x] 2.12 Verify tasks 2.1–2.7 pass

## 3. Server — `prune` endpoint

- [x] 3.1 Author the prune-clears test in `packages/server/src/__tests__/git-worktree-lifecycle-ops.test.ts` (see its temp-repo worktree fixtures). Triple: one registration whose directory was deleted outside git · `POST /api/git/worktree/prune` · that registration is gone from `git worktree list` and the response reports the pruned count (test-plan #X8)
- [x] 3.2 Author the prune-no-op test in the same file. Triple: every registration's directory exists · prune called · succeeds reporting 0 pruned, no registration removed (test-plan #X7)
- [x] 3.3 Author the guard test in `git-worktree-lifecycle-routes.test.ts` (see its existing `networkGuard` rejection cases). Triple: a request the guard denies · call `remove-batch` and `prune` · both rejected before any git command runs; both also respond (not 404) when the guard allows (test-plan #X9)
- [x] 3.4 Add `pruneWorktrees(cwd)` to `git-operations.ts` wrapping `git worktree prune` in the resolved main worktree, returning the pruned count
- [x] 3.5 Register `POST /api/git/worktree/prune` with the `networkGuard` preHandler and `validateCwd`
- [x] 3.6 Verify tasks 3.1–3.3 pass

## 4. Server — per-entry directory existence

- [x] 4.1 Author the existence-reporting test in `packages/server/src/__tests__/git-worktree.test.ts` (see its `parsePorcelainWorktrees` cases). Triple: a repo with 3 registrations, one directory deleted outside git · `GET /api/git/worktrees` · the deleted one reports `exists: false`, the other two `exists: true`, every other field unchanged from the pre-change shape (test-plan #E15)
- [x] 4.2 Author the statSync-cost check in the same suite, timed. Triple: `GET /api/git/worktrees` on a repo with 50 registrations · 20 runs · added wall-clock stays within the noise of the existing `git worktree list` `execSync` cost, comparing medians (test-plan #P2)
- [x] 4.3 Add `exists: boolean` to **both** `WorktreeEntry` declarations — `packages/server/src/git-worktree/git-worktree.ts:30` and the client mirror at `packages/client/src/lib/git/git-api.ts:144` (there is no shared declaration) — and populate it where the porcelain output is parsed/served; additive, no protocol bump (design D8)
- [x] 4.4 Verify no existing consumer of `WorktreeEntry` breaks on the widened type

## 5. Client — git API helpers

- [ ] 5.1 Add `deleteBranch?: boolean` to `removeWorktree()` params in `packages/client/src/lib/git/git-api.ts` and widen its success type to carry `branchDeleted` + `branchDeleteCode`
- [ ] 5.2 Add `removeWorktreeBatch(items)` returning the per-item result array, and `pruneWorktrees({ cwd })`, both via the existing `postLifecycle` helper
- [ ] 5.3 Update `packages/client/src/lib/git/AGENTS.md` and `git-api.ts.AGENTS.md` rows with the new exports

## 6. Client — shared `WorktreeList` component

- [ ] 6.1 Author the default-predicate test in `packages/client/src/components/__tests__/WorktreeList.test.tsx` (see `WorktreeSpawnDialog.test.tsx` for the entry-fixture and render harness). Triple: 9 entries covering every reachable `(isMain, detached, inTree)` combo — main; in-tree attached ×2; in-tree detached ×4; out-of-tree detached ×1; out-of-tree attached ×1 · render with no filter interaction · exactly 3 rows render and the other 6 are absent from the DOM (test-plan #E1)
- [ ] 6.2 Author the chip-coverage test in the same file. Triple: the E1 fixture · read the rendered chip set and counts · every one of the 6 hidden entries is counted by at least one chip; none is uncounted by all chips (test-plan #E2)
- [ ] 6.3 Author the union-count test in the same file. Triple: one entry that is BOTH detached AND out-of-tree · render default view and read `N of M shown` · reports `3 of 9`, the dual-group row counted once, and revealing either chip renders it exactly once (test-plan #E3)
- [ ] 6.4 Author the text-query test in the same file. Triple: entries including one `{branch: null}` detached and one `{branch: null, bare: true}` · type a substring present only in the null-branch entry's path · that row renders and no `TypeError` is thrown (test-plan #E4)
- [ ] 6.5 Author the path-suppression truth-table test in the same file. Triple: five rows — fork `feat-x` in `.worktrees/feat-x`; slash-branch `feat/bar` in `.worktrees/feat-bar`; PR branch `pr-42` in `.worktrees/pr-42`; out-of-tree `~/scratch/my-feature` on branch `my-feature`; detached `{branch: null}` · render each · rows 1–3 suppress the path line, row 4 renders it, row 5 renders it and does not throw in `slugifyBranch` (test-plan #E9)
- [ ] 6.6 Author the main-row guard test in the same file. Triple: an `isMain: true` entry in `mode="manage"` · render then activate "select all N shown" · the main row has neither `✕` nor checkbox and the selection excludes it (test-plan #E10)
- [ ] 6.7 Author the exists tri-state test in the same file. Triple: entries with `exists: true`, `exists: false`, and `exists` absent · render in `mode="manage"` · true → remove enabled; false → no `✕`, excluded from selection, prune affordance shown; absent → treated as present with remove enabled (test-plan #E12)
- [ ] 6.8 Author the separator-normalisation test in the same file. Triple: porcelain paths using `\` separators, main at `C:\repo` and entry at `C:\repo\.worktrees\feat-x` · evaluate the `inTree` predicate · entry classified in-tree, default view does not collapse to the main row alone (test-plan #E13)
- [ ] 6.9 Author the nesting/tab-order test in the same file. Triple: a `mode="manage"` row with checkbox + `✕` · render then Tab through the row · the container is not a `<button>` and both controls are separate tab stops in DOM order (test-plan #F1)
- [ ] 6.10 Author the spawn one-click test in the same file. Triple: `mode="spawn"` · click a row · `onSpawn(entry.path, opts)` fires once and the row is a single `<button>` with no nested interactive element (test-plan #F2)
- [ ] 6.11 Author the elision-integrity test in the same file. Triple: a long out-of-tree path requiring elision · render and read back text content · the leading `.` of a dotted segment stays leading (no bidi artefact such as `worktrees/x.`) and elision falls on a segment boundary (test-plan #F8)
- [ ] 6.12 Author the localisation test in the same file. Triple: the rendered `WorktreeList` in both modes · scan rendered user-facing strings · every new string resolves through `i18nT` (test-plan #F11)
- [ ] 6.13 Create `packages/client/src/components/worktree/WorktreeList.tsx` with `mode: "spawn" | "manage"`, deriving `inTree` from the main entry's path with `\` → `/` normalisation (design D1) — no new predicate field from the server
- [ ] 6.14 Implement the two-line row (identity over path), stripping the constant `.worktrees/` prefix and suppressing the path line only when `inTree && branch != null && basename(normalised(path)) === slugifyBranch(branch)`. The `inTree` gate is load-bearing: `slugifyBranch` collapses `/`→`-` so `feat/bar` yields a single segment `feat-bar`, and PR mode uses branch `pr-<N>` in `.worktrees/pr-<N>` — suppression is the NORMAL case for server-derived in-tree rows; what must never suppress is a free-text `pathOverride` row whose basename matches by coincidence (design D7)
- [ ] 6.15 Implement JS segment-wise elision for out-of-tree paths — never CSS `direction:rtl`, which relocates leading punctuation and corrupts the path (design D7)
- [ ] 6.16 Render branch in `--text-primary` and path in `--text-secondary`; no row text may use `--text-muted` or `--text-tertiary` (design D6 — a deliberate visible restyle, not a refactor)
- [ ] 6.17 Ensure `✕` and checkbox hit areas are ≥24px desktop / ≥44px mobile per WCAG 2.5.8
- [ ] 6.18 Route all new user-facing strings through `i18nT`, matching the host component's existing convention
- [ ] 6.19 Verify tasks 6.1–6.12 pass

## 7. Client — spawn surface adopts the shared list

- [ ] 7.1 Replace §1 of `packages/client/src/components/worktree/WorktreeSpawnDialog.tsx` with `<WorktreeList mode="spawn" />`, preserving `handleSpawnExisting` and the `worktree-row-*` test ids that `WorktreeSpawnDialog.test.tsx` asserts
- [ ] 7.2 Verify the existing `WorktreeSpawnDialog.test.tsx` suite passes unchanged, or update only the assertions the new row structure genuinely invalidates
- [ ] 7.3 Confirm §2 (create-new: fork / checkout / PR modes) is untouched

## 8. Client — manage surface

- [ ] 8.1 Author the menu-gating tests in `packages/client/src/components/__tests__/SessionList.worktree-per-change.test.tsx` (see its existing folder-menu item assertions). Triple: a folder that is not a git repository · build the folder menu items · no manage-worktrees item present (test-plan #F5)
- [ ] 8.2 Author the empty-group regression test in the same file. Triple: a folder for which no workspace-group item applies · open the menu · the workspace group heading does not render — guards the MODIFIED folder-actions-menu delta against dropping this (test-plan #F6)
- [ ] 8.3 Author the session-independence e2e in `tests/e2e/` (see an existing spec for harness glue; read `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`). Triple: a git-repo folder with zero live sessions · open the folder actions menu · the `directory` group contains the manage-worktrees item (test-plan #F4)
- [ ] 8.4 Author the session-less removal e2e in `tests/e2e/`. Triple: a worktree with no entry in the session map · open the manage surface, activate `✕`, confirm · `CloseWorktreeDialog` opens, the removal completes, and no `active_sessions` guard fires (test-plan #X13)
- [ ] 8.5 Author the escalation-inheritance e2e in `tests/e2e/`. Triple: a worktree with 2 active sessions removed from the manage surface · activate `✕` then "End N sessions and remove worktree" · the same escalation flow runs as from `WorktreeActionsMenu` — sessions end, removal retries, worktree is gone (test-plan #X11)
- [ ] 8.6 Author the list-convergence e2e in `tests/e2e/`. Triple: manage dialog open with 3 removable rows · remove one and let the response settle · the list converges to 2 rows without a manual refresh and no row stays permanently pending (test-plan #F3)
- [ ] 8.7 Author the TOCTOU e2e in `tests/e2e/`. Triple: a row whose directory is deleted out-of-band after the list was fetched · activate `✕` and confirm · the client treats the resulting `cwd_invalid` as "already gone", the row leaves the list, and no raw 400 is rendered (test-plan #X5)
- [ ] 8.8 Author the repo-global prune e2e in `tests/e2e/`. Triple: two stale registrations, prune activated from the affordance on one row · activate prune · both stale registrations are cleared and the surfaced copy conveys a repo-global count rather than implying only that row (test-plan #X12)
- [ ] 8.9 Register the `manage-worktrees` item in the menu-item builder in `packages/client/src/components/session/SessionList.tsx`, opening a `Dialog size="lg"` hosting `<WorktreeList mode="manage" />`, gated on the folder being a git repository (design D3)
- [ ] 8.10 Wire per-row `✕` to `CloseWorktreeDialog(cwd)` — passing `allSessions` + `onShutdownSession` through — so `active_sessions` and `dirty_worktree` escalations are inherited unchanged. The dialog is NOT reusable strictly as-is: its `attempt()` posts `{ cwd, force }` only, so `deleteBranch` needs a new optional prop threaded into the POST body
- [ ] 8.11 Handle `cwd_invalid` inside `CloseWorktreeDialog` itself as "already gone" rather than rendering a raw 400 — the two-dialogs-same-cwd race lands there, not only in the bulk bar
- [ ] 8.12 Implement bulk selection + a bulk bar whose single primary action reads `Remove N worktrees`, with `Select all N shown` and the `Delete branch too` option applying per row (rows with `branch == null` skip the branch step — design D5). Do NOT mirror the server's batch cap client-side; surface the rejection code if it ever trips
- [ ] 8.13 Reuse `CloseWorktreeDialog`'s escalation logic for per-row batch recovery rather than reimplementing it; retries MUST carry the original `deleteBranch` intent and the per-item `sessionIds` from the batch response
- [ ] 8.14 Implement partial-failure rendering: a top summary linking to each failure plus an inline strip at each failing row carrying cause and a recovery action, conveyed by icon + text + border (not colour alone)
- [ ] 8.15 Add `Prune stale registrations` as a subordinate footer control reporting the pruned count; copy MUST convey that prune is repo-global (it clears every stale registration, not just the row whose affordance was used)
- [ ] 8.16 Verify tasks 8.1–8.8 pass

## 9. Cross-cutting verification

- [ ] 9.1 Author the contrast e2e in `tests/e2e/` (see an existing spec for harness glue). Triple: the manage list rendered with the real token stylesheet · measure computed contrast of branch and path text against their background in dark and light · every row text run measures ≥ 4.5:1 in BOTH themes and no row text resolves to `--text-muted` or `--text-tertiary` (test-plan #F7)
- [x] 9.2 DROPPED — C1 resolved to "no budget" (batches are rare, blocking accepted), so test-plan #P1 is dropped rather than weakened to an exit-0 assertion
- [ ] 9.3 Author the Windows separator smoke in `qa/tests/*.ps1`. Triple: a real Windows runner with a repo containing one `.worktrees/` entry · run the dashboard and fetch the worktree list, asserting classification at the process level · the in-tree entry is classified in-tree on Windows path separators. If the qa matrix has no Windows target, record that this stays unverified rather than silently dropping it (test-plan #X14)
- [ ] 9.4 Manually verify the chip affordance reads as an action (test-plan: manual-only). A human reads `+ detached 5` and confirms it means "click to add these", not "5 are currently shown" (test-plan #F9)
- [ ] 9.5 Manually verify the two-line row at 375px with the longest real fixture paths (test-plan: manual-only). A human confirms branch and path are both readable with no ambiguous truncation (test-plan #F10)

## 10. Docs and quality gates

- [ ] 10.1 Add `WorktreeList.tsx` to `packages/client/src/components/worktree/AGENTS.md` and create its `WorktreeList.tsx.AGENTS.md` sidecar; update the `WorktreeSpawnDialog.tsx` row to note §1 is now delegated
- [ ] 10.2 Update `packages/server/src/routes/git-routes.ts.AGENTS.md` and `git-operations.ts.AGENTS.md` rows for the two new endpoints, `deleteBranch`, and the `exists` field
- [ ] 10.3 Delegate to DocScribe: update the worktree-lifecycle section of `docs/architecture.md` from "5 endpoints under `/api/git/worktree/*`" to 7, and note the session-less removal path
- [ ] 10.4 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm no `FAIL`
- [ ] 10.5 Run `npm run quality:changed` and clear any new Biome findings
- [ ] 10.6 Final isolated-environment QA per the `isolated-ui-verification` skill (never the live :8000 server): default view hides the harness rows, chips reveal them with correct counts, `✕` removes a session-less worktree, bulk remove reports per-row failures, both themes at 375/768/1440
