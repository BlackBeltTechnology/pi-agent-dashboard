# Tasks — scope-openspec-auto-attach-to-session-cwd

Scenario ids (`E*`, `P*`, `F*`, `X*`) reference `test-plan.md`. Every automated
row there is folded into a task below; each carries its harness exemplar.

Exemplars used:
- Detector unit tests → `packages/extension/src/__tests__/openspec-activity-detector.test.ts` (~55 existing call sites, all of which must gain the new required `cwd` argument)
- Auto-attach server tests → `packages/server/src/__tests__/auto-attach.test.ts`, `auto-attach-slug-defense.test.ts` (mocks the detector module)
- Notify assertions → `packages/server/src/__tests__/notify-log-persistence.test.ts`
- Worktree composition → `packages/server/src/__tests__/git-worktree-compose.test.ts`, `event-wiring-worktree-rekey.test.ts`
- Rendered-UI → `tests/e2e/openspec-artifact-dialog.spec.ts` (docker harness, `FIXTURE_GIT`, `ensureGitSession`)

## 1. Reconnaissance

- [x] 1.1 Confirm the call-site inventory: `detectOpenSpecActivity` has exactly **one** production consumer (`packages/server/src/event-wiring.ts:880`) plus two test files; record it in the PR description so the required-parameter change cannot silently miss one
- [x] 1.2 Read `packages/server/src/__tests__/auto-attach.test.ts` and note which fixtures populate an OpenSpec poll cache — those are the tests most likely to go red for the right reason
- [x] 1.3 Confirm `DirectoryService.getOpenSpecData` can be queried independently for a worktree cwd and its `mainPath`

## 2. Locality resolution helper (TDD)

- [x] 2.1 **E5** — tri-state resolver returns `unknown` when the only candidate root has no cached OpenSpec data; gate allows, zero notify entries. Exemplar: `auto-attach.test.ts`
- [x] 2.2 **E6** — `cwd` cache initialized without the change + `mainPath` cache uninitialized → allow (unknown root dominates). Exemplar: `auto-attach.test.ts`
- [x] 2.3 **E7** — every candidate root initialized, none lists the name → reject. Exemplar: `auto-attach.test.ts`
- [x] 2.4 **E3** — worktree cwd cache initialized *without* `c-a`, `mainPath` cache lists it → allow, `attachedProposal === "c-a"`. This is the regression that would otherwise ship. Exemplar: `auto-attach.test.ts` + `git-worktree-compose.test.ts` fixture shape
- [x] 2.5 **P1** — one gate evaluation against a stubbed `DirectoryService` performs cache reads only; assert zero fresh-poll invocations. Exemplar: `auto-attach.test.ts` with a spy service
- [x] 2.6 Implement the tri-state helper (`present` / `absent` / `unknown`) beside the auto-attach block, reusing `DirectoryService.getOpenSpecData`; do **not** modify `openSpecChangeExistsInCache` — the deleted-proposal bypass depends on its fail-open answer
- [x] 2.7 Implement candidate-root composition: reject only when every root is initialized and none lists the name; any unknown root allows
- [x] 2.8 Verify 2.1-2.5 pass and no existing deleted-proposal-bypass test regressed

## 3. Worktree resolution signal (TDD)

- [x] 3.1 **E9** — bridge reports worktree state for a non-worktree session (cleared/`null` case) → `gitWorktreeReported === true`, and a subsequent detection of an absent change is rejected. Exemplar: `event-wiring-worktree-rekey.test.ts`
- [x] 3.2 **E10** — `isGitRepo === false`, no worktree report ever received → reject-capable without any report. Exemplar: `auto-attach.test.ts`
- [x] 3.3 **E8** — `gitWorktreeReported` falsy and `isGitRepo` undefined → allow (unknown root added). Exemplar: `auto-attach.test.ts`
- [x] 3.4 **X7** — bridge never sends a worktree report AND `isGitRepo` is undefined → gate allows; the unresolved session is never falsely rejected. Exemplar: `auto-attach.test.ts`
- [x] 3.5 **E11** — `gitWorktree.mainPath` restored from `.meta.json` with `gitWorktreeReported` falsy → `mainPath` contributes a root **and** an unknown root is added → allow. Exemplar: `session-scanner` restore fixture + `auto-attach.test.ts`
- [x] 3.6 **X8** — a worktree-state update broadcast to clients contains no `gitWorktreeReported` key. Exemplar: `event-wiring-worktree-rekey.test.ts` broadcast spy
- [x] 3.7 Implement `gitWorktreeReported` as in-memory session state, set whenever `composeWorktreePayload` returns anything other than `undefined` (including the cleared-`null` case); do **not** persist to `.meta.json` and do **not** include it in broadcast payloads
- [x] 3.8 Implement the resolution rule: a session is worktree-resolved when `gitWorktreeReported === true` **or** `isGitRepo === false`; candidate-root rules stay orthogonal (a present `mainPath` always contributes a root; unresolved sessions additionally contribute an unknown root)
- [x] 3.9 Verify 3.1-3.6 pass

## 4. Detector cwd scoping (TDD)

- [x] 4.1 **E12** — path inside cwd → `changeName: "c-a"`. Exemplar: `openspec-activity-detector.test.ts`
- [x] 4.2 **E13** — path in another root → no change name. Exemplar: same
- [x] 4.3 **E14** — sibling-prefix path (`/repo-a-other` vs `/repo-a`) → no change name; prefix is not containment. Exemplar: same
- [x] 4.4 **E15** — relative path resolved against cwd → detected. Exemplar: same
- [x] 4.5 **E16** — the incident command verbatim: `cd /repo-b && openspec new change add-auth` from `cwd=/repo-a` → no change name. Exemplar: same
- [x] 4.6 **E17** — `openspec new change add-auth && cd /repo-b` → no change name (suppression is position-insensitive). Exemplar: same
- [x] 4.7 **E18** — `cd /repo-a/packages/server && openspec new change add-auth` → detected; inside-cwd relocation is not suppressed. Exemplar: same
- [x] 4.8 **E19** — `cd /repo-b && openspec archive c-b` → no change name; suppression covers `CLI_ARCHIVE_RE`. Exemplar: same
- [x] 4.9 **E20** — `openspec validate --change c-b && cd /repo-b` → no change name; suppression covers `CLI_CHANGE_FLAG_RE`. Exemplar: same
- [x] 4.10 Add `cwd` as a **required** parameter to `detectOpenSpecActivity` in `packages/shared/src/openspec-activity-detector.ts`; no permissive default — let TypeScript surface every call site
- [x] 4.11 Relocate the boundary-correct path-containment helper (`isPathInside`, currently `packages/server/src/session/active-sessions-in-cwd.ts`) into `packages/shared` — `shared` has no dependency on `server` and must not gain one; update the server import to the shared copy
- [x] 4.12 Implement path containment with that helper — never string-prefix matching
- [x] 4.13 Implement the conservative `cd`/`pushd` guard: any relocation to a path outside the session cwd disables **all** CLI-pattern detection for that command, regardless of position
- [x] 4.14 Update the single production call site to pass the session cwd from server state, never from model-supplied arguments; update all ~55 detector test call sites
- [x] 4.15 Verify 4.1-4.9 pass and the shared + extension suites are green

## 5. Wire the gate into auto-attach (TDD)

- [x] 5.1 **E1** — cache lists `["c-a"]`, detection for `"c-b"` → `attachedProposal` and `openspecChange` both stay unset, no auto-rename. Exemplar: `auto-attach.test.ts`
- [x] 5.2 **E2** — cache lists `["c-a","c-b"]`, detection for `"c-b"` → attaches (branch 1 unchanged). Exemplar: same
- [x] 5.3 **E21** — on rejection with a manual `attachedProposal="A"`: `openspecChange` unchanged, no branch 1-4 executes, `pendingReplaceProposal` remains unset. Exemplar: same
- [x] 5.4 **E4** — manual attach via `POST /api/session/:id/attach-proposal` for a change absent from every candidate root still applies; the gate is not consulted on manual paths. Exemplar: `proposal-attach-naming.test.ts` / routes tests
- [x] 5.5 **E22** — worktree session, manual `attachedProposal="c-a"` present only in `mainPath` cache, detection for `"c-b"` → attachment NOT treated as deleted; `pendingReplaceProposal === "c-b"`, `attachedProposal` stays `"c-a"`. Exemplar: `auto-attach.test.ts`
- [x] 5.6 **E23** — non-worktree session, manual `attachedProposal="A"` absent from its single initialized root, detection for `"B"` (gate permits) → `attachedProposal === "B"` directly, no dialog; the existing deleted-proposal bypass is not regressed. Exemplar: same
- [x] 5.7 Apply the gate in `event-wiring.ts` ahead of the `openspecChange` write, so both the stamp and the attach branch share one precondition
- [x] 5.8 Widen branch 4's `attachedStillExists` check to the same candidate-root resolution (D9), so a main-checkout-only change is not read as deleted
- [x] 5.9 Verify branch scenarios 1-4 still pass unchanged when the gate permits

## 6. Rejection notice (TDD)

- [x] 6.1 **X1** — the same rejected name detected N times in one turn on non-local evidence → exactly ONE notify entry; log grows by 1. Exemplar: `notify-log-persistence.test.ts`
- [x] 6.2 **X2** — two distinct rejected names → exactly one entry each (2 total). Exemplar: same
- [x] 6.3 **X3** — creation-CLI detection for `"c-a"` rejected on a stale cache, then a write to a path inside `"c-a"` also rejected → **zero** notify entries; the create-then-write flow never emits the misleading message. Exemplar: same
- [x] 6.4 **X4** — a suppressed (locally-evidenced) rejection of `"c-b"`, then a later rejection of `"c-b"` on non-local evidence → exactly one entry naming `"c-b"`; suppression did not consume the dedupe slot. Exemplar: same
- [x] 6.5 **X5** — session unregisters and re-registers with the same id → the notice is appended again; neither the emitted-notice set nor the locally-evidenced set survives unregister. Exemplar: `auto-attach.test.ts` + `onUnregister` path
- [x] 6.6 **X6** — a notice emitted for an idle session adds no pending ask, no pending prompt request, no `currentTool`, and leaves the session reapable. Exemplar: `notify-log-persistence.test.ts`
- [x] 6.7 Implement emission via the existing `handleNotify` in `event-wiring.ts` at level `info`, minting a `notifyId`; do not add a `DashboardSession` field and do not reuse the client-side `noticeSessionIds` set
- [x] 6.8 Implement the per-session **locally-evidenced** set: any change name whose evidence looked local in this session (creation CLI, or an in-cwd path) suppresses its rejection notice
- [x] 6.9 Implement the per-`(sessionId, changeName)` dedupe set tracking **notices actually sent**, never rejections seen; suppressed rejections record no key
- [x] 6.10 Clear both per-session sets on `onUnregister`, alongside the existing registry cleanup
- [x] 6.11 Verify 6.1-6.6 pass

## 7. Rendered-UI verification (Playwright, opt-in)

- [x] 7.1 **F2** — a session in repo A runs an openspec command targeting repo B's change → the card converges to NO attached proposal and NO renamed title (end-to-end reproduction of the incident). Exemplar: `tests/e2e/openspec-artifact-dialog.spec.ts` (`ensureGitSession`, derived `dashboardPort` from `.pi-test-harness.json`)
- [x] 7.2 **F1** (re-routed L3→L1 — see test-plan "Notes on routing"; covered by `auto-attach-locality.test.ts` X1/X2/X6) — a gate rejection on non-local evidence → the card's notification surface converges to exactly one entry naming the change; the session never enters a busy/running visual state. Exemplar: same
- [x] 7.3 Run `npm run test:e2e` against the docker harness (`docker/test-up.sh` … `test-down.sh`)

## 8. Verification

- [x] 8.1 Run the full suite once to a file and grep it: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`
- [x] 8.2 For any pre-existing test that now fails, confirm it fails because it asserted the old permissive behaviour — do **not** weaken the gate to make a test pass
- [x] 8.3 Restart the live server (`curl -X POST http://localhost:8000/api/restart`) and confirm `/api/health` reports the expected mode (`packages/shared` + `packages/server` are jiti — no build step)
- [x] 8.4 Manual check — from a session in this repo, run an `openspec` command prefixed with a `cd` into another repo; confirm no attach, no rename, and exactly one `info` notice on the card
- [x] 8.5 Manual regression check — confirm a worktree session still auto-attaches to a change that exists only in the main checkout (use an existing `.worktrees/os-*` session)
- [x] 8.6 Confirm no session in the live dashboard has been spuriously detached by the change

## 9. Review and documentation

- [x] 9.1 Run the `security-hardening` discipline skill over the diff — the detector consumes model-authored tool arguments and derives a filesystem-scoped identity from them
- [x] 9.2 Run the `review-code` discipline skill before commit (shared package, cross-package helper relocation)
- [x] 9.3 Update the nearest directory `AGENTS.md` rows for every touched file (`packages/shared/src/openspec-activity-detector.ts`, the relocated containment helper, the `packages/server/src/` row for `event-wiring.ts`) with a `See change:` marker
- [x] 9.4 Re-run `openspec validate scope-openspec-auto-attach-to-session-cwd --strict` and confirm it is still valid
