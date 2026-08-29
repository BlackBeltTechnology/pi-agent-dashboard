# Tasks — add-openspec-init-affordances

## 1. Ground truth

- [x] 1.1 Re-verify against the **pinned** `node_modules/@fission-ai/openspec` (currently 1.6.0), NOT `@latest`: `init` registers only `--tools`, `--force`, `--profile`; `--no-animation` and `--no-copilot-cloud` do not exist; commander is strict. The first draft of this change was verified against 1.8.0 and specified an argv that fails on every call.
- [x] 1.2 Re-verify `openspec init` creates `openspec/changes/` + `changes/archive/`, and `openspec list --json` on a zero-proposal project exits 0 with `{"changes": []}`. The `BROKEN` definition rests on this.
- [x] 1.3 Re-verify `--tools pi` writes `.pi/skills/openspec-*` and `.pi/prompts/opsx-*.md`, and that `--tools none` writes neither while still producing `initialized: true`.
- [x] 1.4 Read `packages/shared/src/tool-registry/definitions.ts` and record the resolver entry point for the OpenSpec binary. Bare `openspec` resolves to a squatted `0.0.0` stub.
- [x] 1.5 Read `openspec-routes.ts:149` (`knownCwds`, filters `hasOpenSpecRoot`) and `:165` (`currentGlobalSignature`, closure-local, spawns `openspec config list`). Record why neither is directly reusable: the first excludes init's only targets, the second is unreachable from `directory-service`.
- [x] 1.6 Read `directory-service.ts:486-500` (stat pass) and `:1088` (`reconfigurePolling`, whole-config, iterates every cache on the `enabled` edge; sole call site `system-routes.ts:270`).
- [x] 1.7 Read `session-group-path.ts` `pathKey` and reuse it for `optOutDirectories` normalization. Do not write a second normalization.
- [x] 1.8 Confirm `resolveConfigRoot` (`git-operations.ts:843`) is importable from the polling path, and record the added cost per cwd per tick.
- [x] 1.9 Record the two `initialized: false` branches in `directory-service.ts` (missing `changes/` ~line 498; `openspec list` non-array ~line 520) — these become `missing-changes-dir` vs `cli-failed`.

## 2. Tests first (red) — folded from test-plan.md

Author each before its implementation section and verify it fails. Every row maps to one manifest scenario.

### 2a. L1 readiness derivation — see `packages/server/src/__tests__/directory-service-openspec-enabled.test.ts` for harness glue

- [x] 2.1 `enabled:false` + cwd `initialized:true` · derive readiness · state `GLOBAL_OFF` (test-plan #E1)
- [x] 2.2 cwd in `optOutDirectories` + `initialized:true` · derive readiness · state `OPTED_OUT` (test-plan #E2)
- [x] 2.3 cwd in `optOutDirectories` + no `openspec/` · derive readiness · state `OPTED_OUT`, not `ABSENT` (test-plan #E3)
- [x] 2.4 cwd in `optOutDirectories` + `hasOpenspecDir:true, initialized:false` · derive readiness · state `OPTED_OUT`, no repair offered (test-plan #E4)
- [x] 2.5 `pending:true` · derive readiness · state `PENDING` (test-plan #E5)
- [x] 2.6 `hasOpenspecDir:false`, enabled, not opted out · derive readiness · state `ABSENT` (test-plan #E6)
- [x] 2.7 `hasOpenspecDir:true, initialized:false, pending:false` · derive readiness · state `BROKEN` (test-plan #E7)
- [x] 2.8 `openspec/` present + `openspec/changes/` absent · derive readiness · reason `missing-changes-dir` (test-plan #E8)
- [x] 2.9 `openspec/changes/` present + `openspec list` returns non-array · derive readiness · reason `cli-failed` (test-plan #E9)
- [x] 2.10 `initialized:true` + skills absent + recorded sig ≠ current · derive readiness · `STALE` reason `missing-skills` wins over `profile-stale` (test-plan #E10)
- [x] 2.11 `initialized:true` + skills present + no recorded signature · derive readiness · state `READY` (test-plan #E11)
- [x] 2.12 recorded signature ≠ current · derive readiness · `STALE` reason `profile-stale` (test-plan #E12)
- [x] 2.13 `openspec list` → `{"changes":[]}` + skills present + sig matches · derive readiness · state `READY` (test-plan #E13)
- [x] 2.14 worktree cwd without own skills, main checkout has them · compute `hasOpenSpecSkills` · `true` (test-plan #E14)
- [x] 2.15 non-git dir, config root unresolvable · compute `hasOpenSpecSkills` · falls back to cwd, no throw (test-plan #E15)
- [x] 2.16 non-worktree, `initialized:true`, no `.pi/skills/openspec-explore/` · derive readiness · `STALE` reason `missing-skills` (test-plan #E16)
- [x] 2.17 `offerInitialization:false` + cwd `BROKEN` · derive render decision · folder section still renders with Repair (test-plan #E19)

### 2b. L1 config — see `packages/shared/src/__tests__/config-openspec.test.ts`

- [x] 2.18 `/project/foo/` written to `optOutDirectories` · evaluate `/project/foo` · treated as opted out (test-plan #E17)
- [x] 2.19 config with neither new key · parse · `optOutDirectories: []`, `offerInitialization: true` (test-plan #E18)
- [x] 2.20 config with unrelated keys · write `optOutDirectories` · every other key preserved (test-plan #E23)

### 2c. L1 broadcast + reconfigure — see `packages/server/src/__tests__/directory-service-pending-emit.test.ts`

- [x] 2.21 reconfigure changing only `pollIntervalSeconds` · reconfigurePolling · no readiness re-broadcast (test-plan #E24)
- [x] 2.22 reconfigure adding one cwd to `optOutDirectories` · reconfigurePolling · only that cwd re-broadcast (test-plan #E25)
- [x] 2.23 `enabled` flips true→false · reconfigurePolling · every cleared payload carries `readiness.state === GLOBAL_OFF` (test-plan #E26)

### 2d. L1 init endpoint — see `packages/server/src/__tests__/openspec-group-routes.test.ts`

- [x] 2.24 pinned dir with no `openspec/` · POST init · accepted, not filtered out the way `knownCwds()` would (test-plan #E20)
- [x] 2.25 directory neither session cwd nor pinned · POST init · rejected, no spawn (test-plan #E21)
- [x] 2.26 any valid target · POST init · argv array is exactly `[init, <cwd>, --tools, pi, --force]`, no `--profile`/`--no-animation`/`--no-copilot-cloud` (test-plan #E22)
- [x] 2.27 successful init · inspect store · recorded signature === current, status `up-to-date` (test-plan #E27)
- [x] 2.28 init exits non-zero · inspect store · no signature recorded (test-plan #E28)
- [x] 2.29 CLI exits non-zero · POST init · response reports failure and includes stderr (test-plan #X1)
- [x] 2.30 CLI never exits · POST init, wait 60s · process killed, request fails with partial stderr (test-plan #X2)
- [x] 2.31 prior request timed out · POST init again for that cwd · accepted, not `409` (test-plan #X3)
- [x] 2.32 init in flight for cwd · second POST init same cwd · `409 Conflict`, exactly one spawn (test-plan #X4)
- [x] 2.33 resolved CLI's `init --help` lacks `--tools` · POST init · refused with diagnostic naming the binary, no spawn (test-plan #X5)
- [x] 2.34 two init requests · POST init twice · `init --help` probed once (test-plan #X6)
- [x] 2.35 global profile is the expanded alias · POST init · profile healed before spawn, no `--profile` in argv, spawn succeeds (test-plan #X7)
- [x] 2.36 target already contains `openspec/`, no confirm flag · POST init · refused, no spawn; with the flag · spawn proceeds (test-plan #F17 server half)

### 2e. L1 signature provider + resilience — see `packages/server/src/__tests__/directory-service-refresh-force.test.ts`

- [x] 2.37 20 cwds polled in one tick · count `openspec config list` spawns · exactly 1 (test-plan #P1)
- [x] 2.38 profile save then next tick · count spawns · 1 on the tick after save, not served stale (test-plan #P2)
- [x] 2.39 50 cwds · time the stat pass vs baseline · added wall time < 50ms total (test-plan #P4)
- [x] 2.40 `openspec config list` fails during a tick · poll tick · readiness still emitted, no cwd falsely `STALE` (test-plan #X10)
- [x] 2.41 `resolveConfigRoot` returns null · compute skills · falls back to cwd, no throw, readiness still emitted (test-plan #X11)

### 2f. L1 folder menu — see `packages/client/src/components/__tests__/FolderActionBar.test.tsx`

- [x] 2.42 cwd `OPTED_OUT` · build folder menu · contains "Enable OpenSpec for this folder" (test-plan #E29)
- [x] 2.43 cwd `ABSENT`/`READY`/`BROKEN`/`STALE` · build folder menu · item absent (test-plan #E30)
- [x] 2.44 cwd `OPTED_OUT` but `enabled:false` · build folder menu · item absent (test-plan #E31)
- [x] 2.45 opted-out cwd · activate re-enable · cwd removed from `optOutDirectories` (test-plan #E32)

### 2g. L2 process smoke — see `qa/tests/14-pi-resources-parity.sh`

- [x] 2.46 bare `openspec` 0.0.0 stub earlier on `PATH` · POST init · resolved binary is the tool-registry one, `.pi/skills/openspec-explore/` exists after success (test-plan #X8)
- [x] 2.47 fresh dir, init via endpoint · inspect result · `.pi/skills/openspec-explore/SKILL.md` and `.pi/prompts/opsx-*.md` exist, proving `--tools pi` survived (test-plan #X12)

### 2h. L3 Playwright — see `tests/e2e/openspec-artifact-dialog.spec.ts` and `tests/e2e/folder-status-capsule.spec.ts`. Read the harness port from `.pi-test-harness.json` `dashboardPort`; never hardcode `:18000`

- [ ] 2.48 folder readiness `ABSENT` + `offerInitialization:true` · render session list · one-line pill with Initialize + dismiss, no change count, no board link (test-plan #F1)
- [ ] 2.49 same with `offerInitialization:false` · render · no OpenSpec section for that folder (test-plan #F2)
- [ ] 2.50 folders in `ABSENT`/`BROKEN`/`STALE`/`READY` · render · computed height of each section equals the `READY` section's height (test-plan #F3)
- [ ] 2.51 session whose cwd is `ABSENT` · render card · no element titled `OPENSPEC` (test-plan #F4)
- [ ] 2.52 session whose cwd is `BROKEN` · render card · `OPENSPEC` panel present, no Explore/Propose/Attach/Archive controls in the DOM (test-plan #F5)
- [ ] 2.53 disabled subcard · tab through the panel · exactly one focusable element (test-plan #F6)
- [ ] 2.54 disabled subcard reason `missing-changes-dir`, folder group collapsed · activate control · folder expands, header scrolled into view, focus on OpenSpec section, no dialog opened (test-plan #F7)
- [ ] 2.55 disabled subcard reason `profile-stale` · activate control · navigates to the settings surface holding the OpenSpec profile section (test-plan #F8)
- [ ] 2.56 cards in `BROKEN` / `STALE:missing-skills` / `STALE:profile-stale` · render · three distinct reason strings (test-plan #F9)
- [ ] 2.57 disabled subcard with only reason + one control · render · `OPENSPEC` title still renders, empty-subcard rule does not fire (test-plan #F10)
- [ ] 2.58 payload with no `readiness` field · render card · renders per the old `hasOpenspecDir || pending` gate, never disabled (test-plan #F11)
- [ ] 2.59 folder in `ABSENT` · click Initialize, await broadcast · converges to `OpenSpec (N) →` and the session card OPENSPEC becomes live, with no intermediate disabled or `STALE` state (test-plan #F12)
- [ ] 2.60 folder in `ABSENT` · click dismiss · section stops rendering, cwd persisted in `optOutDirectories` (test-plan #F13)
- [ ] 2.61 opted-out folder · menu → Enable OpenSpec for this folder · section renders again (test-plan #F14)
- [ ] 2.62 folder `BROKEN` reason `cli-failed` · render · no Repair/Initialize control, error text shown (test-plan #F15)
- [ ] 2.63 folder `BROKEN` reason `missing-changes-dir` · click Repair, dismiss the confirm · no request sent (test-plan #F16)
- [ ] 2.64 folder whose cwd already has `openspec/` · click Initialize · confirm naming the directory shown before any request (test-plan #F17)
- [ ] 2.65 init fails · click Initialize · stderr surfaced, section stays `ABSENT` and does not show success (test-plan #X9)
- [ ] 2.66 session list with 10 folders + 40 session cards · page load + 30s idle · `GET /api/openspec/update-status` request count from card rendering is 0 (test-plan #P3)

## 3. Server + shared

- [x] 3.1 Add `OpenSpecData.hasOpenSpecSkills?: boolean`, stat `<configRoot>/.pi/skills/openspec-explore/` in the existing stat pass, falling back to cwd when the config root is unresolvable.
- [x] 3.2 Add `OpenSpecData.readiness: { state, reason }` and the server-side derivation with the documented precedence.
- [x] 3.3 Extract the global-signature helper out of the route closure into a shared provider; inject it into the polling service; compute at most once per tick and cache; invalidate on profile save, init, and update.
- [x] 3.4 Add `openspec.optOutDirectories: string[]` and `openspec.offerInitialization: boolean` to the config type and parser, normalizing keys with `pathKey`.
- [x] 3.5 Honor the opt-out in the poll gate so an opted-out cwd is not polled.
- [x] 3.6 Make `reconfigurePolling` diff the readiness-affecting keys, re-broadcast only on those, target only membership-changed cwds for `optOutDirectories`, and carry `readiness` on every emitted payload including the cleared one.
- [x] 3.7 Add the REST write for `optOutDirectories` / `offerInitialization`, atomic against the rest of the config.
- [x] 3.8 Add `POST /api/openspec/init`: resolver-based binary, argv `[init, <cwd>, --tools, pi, --force]`, `healExpandedProfileConfig` first, validation against the un-filtered known-directory set, confirm flag required when `openspec/` exists, per-cwd serialization returning `409`, 60s timeout, cached `init --help` support probe, signature recorded on success, forced poll refresh, stdout/stderr returned.
- [x] 3.9 `security-hardening` pass on 3.8 — repo-writing CLI at a caller-supplied path. Review the validation set, argv-as-array, the `--force` blast radius (note `--tools` alone already authorizes cleanup), the confirm gate, and the timeout/lock interaction.

## 4. Client

- [x] 4.1 Convert every gate site to consume `readiness`: `SessionCard.tsx:969`, `SessionList.tsx:1289`, `ComposerSessionActions.tsx:221`, `FolderOpenSpecSection.tsx:29,44`, `App.tsx:1807`. Include the legacy fallback when `readiness` is absent.
- [x] 4.2 `FolderOpenSpecSection`: replace `return null` with the `ABSENT`/`BROKEN`/`STALE` variants, one action each, keyed on reason; dismiss only on `ABSENT`; `cli-failed` renders no destructive action.
- [x] 4.3 Confirm dialogs for Repair and for Initialize over an existing `openspec/`.
- [x] 4.4 `SessionCard`: readiness gate plus the inert disabled path — action controls removed from the DOM, reason as visible text, one focusable control routed by reason.
- [x] 4.5 Implement the scroll-into-view + expand-if-collapsed + focus behaviour for the folder-targeted control.
- [x] 4.6 Folder actions menu: conditional "Enable OpenSpec for this folder".
- [x] 4.7 `OpenSpecProfileSection`: surface `offerInitialization` and the opted-out directory list.
- [x] 4.8 i18n strings for every new label and reason, in each maintained locale.

## 5. Verify

- [ ] 5.1 Full suite green: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`
- [ ] 5.2 `npm run quality:changed` clean
- [ ] 5.3 `npm run test:e2e` green against the docker harness
- [ ] 5.4 `review-code` on the full diff before commit
- [ ] 5.5 Manual: real directory with no `openspec/` → Initialize → session-card OPENSPEC controls actually work end to end (test-plan: manual-only)
- [ ] 5.6 Manual: `openspec init --tools none` in a scratch dir → presents as `STALE`/`missing-skills`, not `READY` (test-plan: manual-only)
- [ ] 5.7 Manual: session list with ~20 OpenSpec-less folders — the offer reads as one calm line per folder, not a wall (test-plan #F18, manual-only)
- [ ] 5.8 Manual: a card with a disabled OPENSPEC subcard reads as deliberately unavailable, not as a broken or loading panel (test-plan #F19, manual-only)

## 6. Docs

- [ ] 6.1 Delegate to `DocScribe` (caveman style): `docs/architecture.md` gains the readiness state table, the `optOutDirectories`/`offerInitialization` config reference, and the init endpoint contract; `docs/faq.md` gains "OpenSpec buttons do nothing" → the readiness states and their fixes.
- [ ] 6.2 Apply the returned directory-`AGENTS.md` rows for every touched file.
