## 1. Shared setup-state helper

- [ ] 1.1 Move `setupState` from `packages/client/src/components/folder/FolderActionBanner.tsx` into `packages/client/src/lib/init-setup-state.ts`; re-export it from the banner so existing imports keep compiling. Verify `npx vitest run packages/client/src/components/folder` stays green.

## 2. `useInitStatus` tests first (L1, harness exemplar: `packages/client/src/hooks/__tests__/useAsyncAction.test.tsx` for `renderHook` + fake timers; mock `fetchWorktreeInitStatus` from `lib/git/git-api.js`). Author all in `packages/client/src/hooks/__tests__/useInitStatus.test.tsx`, verify each FAILS before section 3.

- [ ] 2.1 Configured row never re-probes (test-plan #E1): input probe returns checklist `settings.present: true`, `isProjectRoot: true`, session `streaming` · trigger status → `idle` · observable fetch call count stays 1.
- [ ] 2.2 Non-project-root row never re-probes (test-plan #E2): input `settings.present: false`, `isProjectRoot: false`, session `streaming` · trigger → `idle`, then `visibilitychange` → `visible` at +31 s · observable call count stays 1.
- [ ] 2.3 No interpretable probe yet keeps gate closed (test-plan #E3): input only probe returns `{ hasHook: false }`, `isProjectRoot: true` · trigger session `streaming → idle` · observable call count stays 1.
- [ ] 2.4 Visibility throttle boundary (test-plan #E4): input not-a-project root, last probe issued at t0 (fake timers) · trigger `visible` at t0+29 999 ms then t0+30 000 ms · observable 0 extra calls, then exactly 1.
- [ ] 2.5 Throttle stamped at issue (test-plan #E5): input refetch issued at t0 that never resolves · trigger `visible` at t0+10 s · observable no extra call.
- [ ] 2.6 Entering streaming/active never fires (test-plan #E6): input not-a-project root, session seeded `idle` · trigger → `streaming` then → `active` · observable call count stays 1.
- [ ] 2.7 Coalesced triggers (test-plan #E7): input sessions A,B `streaming` · trigger one update A → `idle`, B → `ended` · observable exactly 1 extra call.
- [ ] 2.8 Unrelated re-render is a no-op (test-plan #E8): input `[A: idle]` · trigger new array instance with identical `id:status` · observable call count unchanged.
- [ ] 2.9 Setup turn finishes, session stays open (test-plan #F1): input not-a-project root, A seeded `streaming`, next probe → `present: true` · trigger A → `idle` · observable exactly 1 extra call and hook `status` equals the `present: true` payload.
- [ ] 2.10 Session ends (test-plan #F2): input A seeded `active` · trigger A → `ended` · observable exactly 1 extra call.
- [ ] 2.11 Turn completed while unobserved (test-plan #F3): input seeded `[A: streaming]` · trigger update to `[A: streaming, B: idle]` · observable exactly 1 extra call.
- [ ] 2.12 Session vanishes before `ended` seen (test-plan #F4): input seeded `[A: streaming]` · trigger update to `[]` · observable exactly 1 extra call.
- [ ] 2.13 First snapshot only seeds (test-plan #F5): input none · trigger mount with `[A: idle, B: ended]` · observable call count = 1.
- [ ] 2.14 Latest-wins (test-plan #F6): input two deferred refetches (#1 → absent, #2 → present) · trigger resolve #2 then #1 · observable final `status` is the #2 payload.
- [ ] 2.15 No set-after-unmount (test-plan #F7): input deferred refetch · trigger unmount then resolve · observable no React state-update warning, no throw.
- [ ] 2.16 Failed probe keeps gate open (test-plan #X1): input probe 1 → `present: false`, probe 2 → `{ hasHook: false }` · trigger two successive `streaming → idle` transitions · observable probe 3 is issued; displayed status after probe 2 has `setupState` `unknown`.
- [ ] 2.17 Abandoned setup (test-plan #X2): input not-a-project root, next probe still `present: false` · trigger session → `ended` · observable 1 extra call and displayed status still not-a-project.

## 3. `useInitStatus` implementation

- [ ] 3.1 Implement design D1 + D2 in `packages/client/src/hooks/useInitStatus.ts`: `opts?: { sessions, isProjectRoot }`; seeded `Map<id,status>`; fire on transition into `idle`/`ended`, first-seen `idle`/`ended`, or disappearance of a non-ended id; gate on `isProjectRoot && lastInterpretable === "not-a-project"`; effect keyed on sorted `id:status` signature; request-id latest-wins + mounted ref; `lastProbeAt` stamped at issue; `visibilitychange` listener with 30 000 ms throttle. Update the file header comment. Verify tasks 2.1–2.17 pass.

## 4. Wire the row and simplify the banner

- [ ] 4.1 Setup action spawns directly (test-plan #F8) in `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx` (harness exemplar: the existing cases in that file): input rung `setup`, `onInitializeProject` spy · trigger click `folder-banner-setup-action-<cwd>` · observable spy called once with `cwd`. Verify it passes after 4.5.
- [ ] 4.2 Next rung after scaffold (test-plan #F10) in the same file: input `computeBannerRung({ hasHook: true, trusted: false, checklist: [settings present] }, undefined, true)` · trigger evaluate · observable returns `"retrust"`. Regression pin; verify it passes.
- [ ] 4.3 Remount-survival test (test-plan #F9) in `packages/client/src/hooks/__tests__/useInitStatus.test.tsx` (harness exemplar: `useActiveChatSelection.test.tsx`): input a host component that owns `useInitStatus` and conditionally renders a `FolderActionBanner` child, not-a-project root · trigger unmount/remount the banner child, then session `streaming → idle` with next probe → present · observable exactly 1 extra call and `folder-banner-setup-<cwd>` absent after re-render. Verify it fails before 4.4/4.5.
- [ ] 4.4 In `packages/client/src/components/session/SessionList.tsx`: hoist the `isProjectRoot` expression once per row; `FolderInitScope` accepts `sessions` + `isProjectRoot` and calls `useInitStatus(cwd, { sessions, isProjectRoot })`; both banner call sites reuse the hoisted value. Verify `npx tsc -p packages/client --noEmit`.
- [ ] 4.5 Remove spawn tracking from `FolderActionBanner` (design D3): drop `pendingSpawn`, `knownIdsRef`, `spawnedIdRef`, the `ended` effect and the `sessions` prop; setup button calls `onInitializeProject(cwd)`; remove `sessions={group.sessions}` from both call sites; update the header comment. Verify typecheck and tasks 4.1–4.3 pass.

## 5. Project-init OpenSpec detection (skill)

- [ ] 5.1 Config fail-closed text guard (test-plan #E9) in `packages/extension/src/__tests__/project-init-openspec-skill-text.test.ts` (harness exemplar: `packages/extension/src/__tests__/project-init-scaffold.test.ts` for repo-relative file reads), reading `packages/extension/.pi/skills/project-init/SKILL.md`; verify it fails before 5.6: input SKILL.md · trigger read · observable Step 3b names unreadable/wrong-typed `~/.pi/dashboard/config.json` → skip + warn, and absent key → defaults for `enabled`, `offerInitialization`, `optOutDirectories`.
- [ ] 5.2 Opt-out one-liner executes correctly (test-plan #E10) in the same test file: input the embedded `node -e` comparison extracted from SKILL.md · trigger execute it for target `/Users/x/Proj` vs `/users/x/proj/` (platform darwin), `/Users/x/Proj` (linux), `/Users/x/Other` · observable match, match, no-match; verify it fails before 5.6.
- [ ] 5.3 Git placement + offer-switch text guard (test-plan #E11) in the same test file: observable Step 3b contains `--path-format=absolute`, `--is-inside-work-tree`, `--show-toplevel`, the `offerInitialization === false` skip-offer rule, and the repair row keyed on `.pi/skills/openspec-explore`; verify it fails before 5.6.
- [ ] 5.4 Command + legacy-disclosure text guard (test-plan #E12) in the same test file: observable Steps 3b/3c/6 use `openspec init --tools pi --force`; every entry of `LEGACY_CONFIG_FILES`, `LEGACY_COMMAND_DIRS`, `LEGACY_COMMAND_FILE_DIRS` parsed from `packages/server/src/routes/openspec-routes.ts` appears; both `OPENSPEC:START` and `OPENSPEC:END`, the "other legacy OpenSpec files" line and global-config migration are mentioned; verify it fails before 5.6.
- [ ] 5.5 Step 6 gate + verify text guard (test-plan #E13) in the same test file: observable Step 6 runs on `repair` or confirmed `offer`, verifies `.pi/skills/openspec-explore`, warns with an `ls .pi/skills` listing, and the "Idempotent re-run" paragraph no longer says Step 6 is skipped whenever `./openspec/` existed; verify it fails before 5.6.
- [ ] 5.6 Edit `packages/extension/.pi/skills/project-init/SKILL.md` per design D4: Step 3b computes `OPENSPEC_MODE` (7-row first-match table incl. fail-closed config, `pathKey` `node -e` one-liner with worked example, git placement checks, `offerInitialization`), legacy detection lists; Step 3c preview disclosure; Step 6 gate/command/verify/warn; rewrite the "Idempotent re-run" paragraph. Verify 5.1–5.5 pass.

## 6. Browser E2E (L3)

- [ ] 6.1 Extend `tests/e2e/folder-action-banner.spec.ts` (harness exemplar: same file's `kb-sample` pinned fixture; container write via `docker exec` as in `tests/e2e/archive-fold.spec.ts`; `visibilityState` override as in `tests/e2e/openspec-board-drop.spec.ts:367`) with tab-return clears banner (test-plan #F11): input pinned session-less fixture without `.pi/settings.json` showing `folder-banner-setup-<cwd>` · trigger write `<cwd>/.pi/settings.json` (`{}`) in the container, let > 30 s elapse since the last probe, dispatch `visibilitychange` hidden → visible · observable `folder-banner-setup-<cwd>` detaches without page reload. Restore the fixture (delete the file) in `afterEach`. Verify with `npm run test:e2e -- folder-action-banner` against the local harness.

## 7. Docs, review, manual QA

- [ ] 7.1 Update DOX rows with `See change: fix-project-setup-completion-state`: `packages/client/src/hooks/useInitStatus.ts.AGENTS.md` (or its directory row), `packages/client/src/components/folder/AGENTS.md`, new `packages/client/src/lib/` row for `init-setup-state.ts`, `packages/extension/src/__tests__` row for the new text-guard test, `packages/extension/.pi/skills/project-init/SKILL.md.AGENTS.md`, `tests/e2e/folder-action-banner.spec.ts.AGENTS.md` (add #F11). Verify `node scripts/check-conventions.mjs` reports no violations.
- [ ] 7.2 Full test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`; verify no failures.
- [ ] 7.3 `doubt-driven-review` on the final SKILL.md Step 3b/3c/6 text (repair disclosure), then `review-code` on the full diff; resolve blocking findings.
- [ ] 7.4 Manual: live setup turn clears the banner (test-plan: manual-only, #F12) — real dashboard, unconfigured git repo, `Set up →`, complete project-init, leave the session open; banner leaves the setup rung (re-trust may appear) without ending the session or reloading.
- [ ] 7.5 Manual: OpenSpec repair on a non-pi OpenSpec dir (test-plan: manual-only, #X3) — scratch git repo with `openspec/changes/` and no `.pi/`; run project-init (coding), confirm preview; no OpenSpec question, preview lists repair + side effects, `.pi/skills/openspec-explore/` exists after, folder OpenSpec pill not "skills missing".
- [ ] 7.6 Manual: opted-out dir never repaired (test-plan: manual-only, #X4) — same scratch repo listed in `openspec.optOutDirectories`; run project-init (coding); no OpenSpec command runs and the note says opted out.
