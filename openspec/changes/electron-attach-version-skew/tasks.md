# Tasks

TDD per group: write the group's test tasks first, verify they fail, then the implementation task, verify they pass. L1 runs with `npx vitest run <file>`; electron runs with the `_electron` suite (`playwright.electron.config.ts`).

## 1. Read-only expected runtime (design D1)

- [x] 1.1 Test (L1) bundle is the expected runtime — exemplar `packages/electron/src/lib/__tests__/runtime-overlay.test.ts`. input: fixture bundle manifest `0.10.0`, no overlays · trigger: `resolveExpectedRuntime()` · observable: `{source:"bundled", version:"0.10.0"}` (test-plan #E12)
- [x] 1.2 Test (L1) active overlay is the expected runtime — exemplar `runtime-overlay.test.ts`. input: bundle `0.10.0` + committed compatible overlay `0.10.1` · trigger: `resolveExpectedRuntime()` · observable: `{source:"overlay", version:"0.10.1"}` (test-plan #E13)
- [x] 1.3 Test (L1) incompatible overlay skipped without recording — exemplar `runtime-overlay.test.ts`. input: overlay with `minShellVersion` above shell · trigger: `resolveExpectedRuntime()` · observable: resolves `bundled`; `state.json` and `request.json` byte-identical before/after (test-plan #E14)
- [x] 1.4 Test (L1) exhausted pending runtime resolved but not persisted — exemplar `runtime-overlay.test.ts`. input: `request.pending = X`, attempts at max, uncommitted · trigger: `resolveExpectedRuntime()` then `planColdLaunch()` · observable: X skipped, files byte-identical after the peek; `planColdLaunch()` then marks X bad (test-plan #E15)
- [x] 1.5 Test (L1) peek/persist parity with an explicit update — exemplar `runtime-overlay.test.ts`. input: unconsumed explicit-update request · trigger: `peekColdLaunch()` and `planColdLaunch()` on copies of one fixture · observable: identical `inputs`; only `planColdLaunch` changes files (test-plan #E16)
- [x] 1.6 Test (L1) non-release source yields unknown — exemplar `packages/electron/src/lib/__tests__/launch-source.test.ts`. input: resolver returns `devMonorepo`, then `localLink`, then bundle with no manifest · trigger: `resolveExpectedRuntime()` ×3 · observable: `version:null` ×3 (test-plan #E17)
- [x] 1.7 Test (L1) resolution errors are silent — exemplar `launch-source.test.ts`. input: resolver throws `BundledServerMissingError`, then `PinnedSourceUnavailableError` · trigger: `resolveExpectedRuntime()` · observable: returns `version:null`, does not throw (test-plan #E18)
- [x] 1.8 Implement `peekColdLaunch()` in `runtime-overlay.ts` (refactor `planColdLaunch` = peek + persist) and `resolveExpectedRuntime()` in `runtime-overlay-main.ts` (`skipAttach:true`, `gateRuntimeRoot`, no-op `onFallThrough`, `readRuntimeManifest`, try/catch → null). Verify 1.1–1.7 pass and the existing `runtime-overlay.test.ts` stays green.
- [x] 1.9 Update the `runtime-overlay.ts` and `runtime-overlay-main.ts` rows in `packages/electron/src/lib/AGENTS.md` (new exports, read-only contract, `See change: electron-attach-version-skew`).

## 2. Decision helper (design D2, D2b)

- [x] 2.1 Test (L1) matching versions → none — exemplar `packages/electron/src/lib/__tests__/server-lifecycle.test.ts` (`decideIsZombie` cases). input: health `0.10.0` electron, expected `0.10.0`, packaged · trigger: `decideAttachAction()` · observable: `none` (test-plan #E1)
- [x] 2.2 Test (L1) cosmetic version difference → none — exemplar `server-lifecycle.test.ts`. input: server `" v0.10.0 "`, expected `0.10.0` · trigger: `decideAttachAction()` · observable: `none` (test-plan #E2)
- [x] 2.3 Test (L1) unknown server version → none — exemplar `server-lifecycle.test.ts`. input: server version `"unknown"`, `""`, absent · trigger: `decideAttachAction()` ×3 · observable: `none` ×3 (test-plan #E3)
- [x] 2.4 Test (L1) unknown expected version → none — exemplar `server-lifecycle.test.ts`. input: expected `null`, server `0.9.0` · trigger: `decideAttachAction()` · observable: `none` (test-plan #E4)
- [x] 2.5 Test (L1) unpackaged → none — exemplar `server-lifecycle.test.ts`. input: `isPackaged:false`, `0.9.0` vs `0.10.0` · trigger: `decideAttachAction()` · observable: `none` (test-plan #E5)
- [x] 2.6 Test (L1) electron skew with dead owner → restart default — exemplar `server-lifecycle.test.ts`. input: electron, non-zombie, `bootParentAlive:false`, `0.9.0` vs `0.10.0` · trigger: `decideAttachAction()` · observable: `skew-restart`, `restartIsDefault:true` (test-plan #E6)
- [x] 2.7 Test (L1) live or unknown owner → Leave running default — exemplar `server-lifecycle.test.ts`. input: as 2.6 with `bootParentAlive:true`, then absent · trigger: `decideAttachAction()` ×2 · observable: `skew-restart`, `restartIsDefault:false` ×2 (test-plan #E7)
- [x] 2.8 Test (L1) skewed zombie → merged — exemplar `server-lifecycle.test.ts`. input: `isZombie:true`, `0.9.0` vs `0.10.0` · trigger: `decideAttachAction()` · observable: `skew-zombie-merged` (test-plan #E8)
- [x] 2.9 Test (L1) zombie with match or unknown → zombie — exemplar `server-lifecycle.test.ts`. input: `isZombie:true`, equal versions; then expected `null` · trigger: `decideAttachAction()` ×2 · observable: `zombie` ×2 (test-plan #E9)
- [x] 2.10 Test (L1) non-electron skew → info only — exemplar `server-lifecycle.test.ts`. input: launch source `standalone`, `bridge`, `bridge-orphaned`, absent, `"weird"` · trigger: `decideAttachAction()` ×5 · observable: `skew-info` ×5, never `skew-restart` (test-plan #E10)
- [x] 2.11 Test (L1) dismissal key includes launch source — exemplar `server-lifecycle.test.ts`. input: dismissed `{0.9.0, 0.10.0, standalone}` · trigger: standalone same pair; bridge same pair; standalone `0.9.0`/`0.10.1` · observable: `none`; `skew-info`; `skew-info` (test-plan #E11)
- [x] 2.12 Implement `decideAttachAction()` + version normalisation in `server-lifecycle.ts`. Verify 2.1–2.11 pass; update its `packages/electron/src/lib/AGENTS.md` row.

## 3. Doctor text reuse (design D6)

- [x] 3.1 Test (L1) Doctor output unchanged after extraction — exemplar `packages/shared/src/__tests__/doctor-core.test.ts`. input: launch sources `standalone`, `bridge`, `bridge-orphaned`, `electron`, absent; app `0.10.0` · trigger: `attachedServerVersionSuggestion()` and `checkAttachedServerVersion()` · observable: suggestions equal today's literal strings; Doctor row byte-identical to the pre-change snapshot (test-plan #E21)
- [x] 3.2 Implement: extract `attachedServerVersionSuggestion()` in `packages/shared/src/doctor-core.ts`. Verify 3.1 and the existing `doctor-core*.test.ts` files pass; update the `doctor-core.ts` row/sidecar in `packages/shared/src/`.

## 4. Dismissal file (design D7)

- [x] 4.1 Test (L1) dismissal persistence bounds — exemplar `packages/electron/src/lib/__tests__/wizard-state.test.ts` (temp HOME). input: file absent / corrupt / 19, 20, 21 pairs / a duplicate · trigger: `addDismissedVersionSkew()` + read · observable: absent/corrupt → `[]`; the 21st evicts the oldest (length 20); duplicate not re-added; write goes through tmp + rename (test-plan #E19)
- [x] 4.2 Test (L1) dismissal does not touch settings — exemplar `wizard-state.test.ts`. input: temp HOME without `dashboard-settings.json` · trigger: `addDismissedVersionSkew()` · observable: `dashboard-settings.json` still absent; `isFirstRun()` still `true` (test-plan #E20)
- [x] 4.3 Implement the read/add helpers for `~/.pi-dashboard/version-skew-dismissals.json` (FIFO 20, dedupe, atomic write) beside `wizard-state.ts`. Verify 4.1–4.2 pass; add/update the AGENTS.md row.

## 5. Dialogs (design D5)

- [x] 5.1 Test (L1) dialog contracts — exemplar `packages/electron/src/lib/__tests__/zombie-adoption.test.ts`. input: stubbed `dialog.showMessageBox` · trigger: `promptVersionSkewRestart({restartIsDefault:true/false})`, `promptMergedZombieSkew`, `promptVersionSkewInfo` · observable: buttons [Restart with v0.10.0, Leave running] default 0 / 1; [Restart with v0.10.0, Take ownership, Leave running] default 0, cancel = Leave running; [OK, Don't show again for this version pair] default 0; message contains `0.9.0` and `0.10.0` (test-plan #E23)
- [x] 5.2 Test (L1) info modal disclosure line — exemplar `zombie-adoption.test.ts`. input: shell `0.10.0` + expected `0.10.1`; then expected `0.10.0` · trigger: build the info-modal detail · observable: the first contains "installs v0.10.0" and "v0.10.1"; the second has no disclosure line (test-plan #E22)
- [x] 5.3 Implement the dialog functions and `notifyRestartOutcome` in `zombie-adoption-dialog.ts`. Verify 5.1–5.2 pass; update its AGENTS.md row.

## 6. Force restart and liveness-confirmed kill (design D4, D4b)

- [x] 6.1 Test (L1) graceful restart sends no signal — exemplar `packages/electron/src/lib/__tests__/server-lifecycle-launch.test.ts`. input: PID 4242 reports `ESRCH` 1.0 s after `/api/shutdown` · trigger: `requestServerLaunch({force:true})` · observable: no signal; spawner called once, after `ESRCH`; returns `started` (test-plan #X1)
- [x] 6.2 Test (L1) waits for the PID, not the port — exemplar `server-lifecycle-launch.test.ts`. input: port closes at 0.2 s, PID alive until 3 s · trigger: `requestServerLaunch({force:true})` · observable: spawner not called before 3 s, called after; no signal (test-plan #X2)
- [x] 6.3 Test (L1) SIGTERM escalation at the 5 s boundary — exemplar `server-lifecycle-launch.test.ts`. input: PID alive continuously 5.0 s, dies 1 s after SIGTERM · trigger: `requestServerLaunch({force:true})` · observable: SIGTERM at ≥5.0 s, no SIGKILL, spawn after `ESRCH` (test-plan #X3)
- [x] 6.4 Test (L1) 2 s post-SIGKILL bound — exemplar `zombie-adoption.test.ts`. input: PID survives SIGTERM; after SIGKILL dies at 1.8 s (run A) and at 2.2 s (run B) · trigger: `stopZombieServer()` and the force branch · observable: A → `true` + spawn; B → `false`, force returns `failed`, spawner never called (test-plan #X4)
- [x] 6.5 Test (L1) `EPERM` counts as alive — exemplar `zombie-adoption.test.ts`. input: `process.kill(pid,0)` throws `EPERM` throughout · trigger: force branch · observable: escalation then `failed`; spawner never called (test-plan #X5)
- [x] 6.6 Test (L1) surviving foreign server is not `started` — exemplar `server-lifecycle-launch.test.ts`. input: PID gone but another server still answers the port · trigger: `requestServerLaunch({force:true})` · observable: `failed` naming the surviving server; spawner not called (test-plan #X6)
- [x] 6.7 Test (L1) shutdown POST failure still waits — exemplar `server-lifecycle-launch.test.ts`. input: `/api/shutdown` fetch rejects; PID dies at 0.5 s · trigger: `requestServerLaunch({force:true})` · observable: spawns after `ESRCH`; returns `started` (test-plan #X7)
- [x] 6.8 Test (L1) zombie Stop now does not respawn when the kill fails — exemplar `zombie-adoption.test.ts`. input: `stopZombieServer` returns `false` · trigger: zombie "Stop now" flow · observable: notice shown; `resolveAndSpawnRuntime` not called (test-plan #X8)
- [x] 6.9 Test (L1) shared liveness option — exemplar `packages/shared/src/__tests__/platform-process.test.ts`. input: injected `kill` throwing `ESRCH`, then `EPERM`, then succeeding · trigger: `isProcessAlive(pid, {epermAlive:true})` and default `isProcessAlive(pid)` · observable: opt-in `false`/`true`/`true`; default `false`/`false`/`true` (test-plan #E24)
- [x] 6.10 Implement: `isProcessAlive` `epermAlive` option in `packages/shared/src/platform/process.ts`; `stopZombieServer` using `isProcessAlive(pid, {epermAlive:true})` (2 s post-SIGKILL poll at 200 ms); tighten the `requestServerLaunch` force branch (read PID first, PID-gone wait, escalation, surviving-server → `failed`); make zombie "Stop now" in `main.ts` honour the return value. Verify 6.1–6.9 and the existing `server-lifecycle*.test.ts` / `zombie-adoption.test.ts` pass; update AGENTS.md rows.

## 7. Attach evaluation and restart orchestration (design D3, D4)

- [x] 7.1 Test (L1) evaluation never delays the window — exemplar `server-lifecycle-launch.test.ts` (injected deps). input: health fake delayed 3 s, resolver delayed 1 s · trigger: attach arm · observable: `createMainWindow` recorded before the health fetch resolves (test-plan #P1)
- [x] 7.2 Test (L1) changed identity aborts the restart — exemplar `server-lifecycle-launch.test.ts`. input: modal for PID 4242; re-fetch reports PID 5151 (and separately a different `bootParentPid`) · trigger: Restart chosen · observable: no `/api/shutdown`, no signal, "restart did not complete" notice (test-plan #X9)
- [x] 7.3 Test (L1) already up to date — exemplar `server-lifecycle-launch.test.ts`. input: re-fetch `version` = expected · trigger: Restart chosen · observable: no `/api/shutdown`; "already up to date" notice (test-plan #X10)
- [x] 7.4 Test (L1) foreign server not adopted after restart — exemplar `server-lifecycle-launch.test.ts`. input: `started` but health `pid` ≠ `getStoredSpawnedPid()` (and separately `launchSourceEffective:"standalone"`) · trigger: post-restart verification · observable: recovery page shown, no success notice (test-plan #X11)
- [x] 7.5 Test (L1) runtime fallback reported — exemplar `server-lifecycle-launch.test.ts`. input: promised `0.10.1`, new health `0.10.0` · trigger: post-restart verification · observable: notice naming v0.10.0 running instead of v0.10.1 (test-plan #X12)
- [x] 7.6 Test (L1) launch failure shows recovery — exemplar `server-lifecycle-launch.test.ts`. input: `requestServerLaunch` → `failed` after the old PID is gone · trigger: restart flow · observable: outcome notice and `showServerRecovery()` called once (test-plan #X13)
- [x] 7.7 Test (L1) Leave running / OK are lifetime-scoped — exemplar `server-lifecycle-launch.test.ts`. input: user picks Leave running (restart modal), then OK (info modal) · trigger: second evaluation in the same lifetime; then a fresh evaluator · observable: no dialog the second time; dialog again with the fresh evaluator (test-plan #X14)
- [x] 7.8 Test (L1) unreachable health is silent — exemplar `server-lifecycle-launch.test.ts`. input: `/api/health` rejects / non-200 · trigger: `evaluateAttachedServer()` · observable: no dialog, no throw, `[attach-check]` log with reason `health-unreachable` (test-plan #X15)
- [x] 7.9 Implement `packages/electron/src/lib/attach-evaluation.ts` (`evaluateAttachedServer` with injected deps, one `[attach-check]` log line per evaluation, `--no-zombie-prompt` → log only) and wire it on the attach arm of `main.ts` in place of `maybePromptZombieAdoption()`, which stays the `zombie` branch. Verify 7.1–7.8 pass; add the new AGENTS.md row and update `main.ts`'s row/sidecar.

## 8. `_electron` suite (design D8)

- [x] 8.1 Test (electron) zombie fixture follows the bundle — exemplar `tests/e2e-electron/zombie-adoption.electron.spec.ts`. input: existing zombie scenarios with fixture `version` read from the bundled `runtime-manifest.json` (replacing hard-coded `0.5.4`) · trigger: launch · observable: the three original adoption buttons are still asserted (test-plan #F3)
- [x] 8.2 Test (electron) merged modal for a skewed zombie — exemplar `zombie-adoption.electron.spec.ts`. input: zombie fake health with manifest version patch+1 · trigger: launch without `--no-zombie-prompt` · observable: `showMessageBox` called exactly once with Restart with v<manifest>, Take ownership, Leave running (test-plan #F1)
- [x] 8.3 Test (electron) info modal never stops an external server — exemplar `tests/e2e-electron/doctor-version-skew.electron.spec.ts`. input: fake health `standalone`, different version · trigger: launch, stub returns 0 · observable: info modal shown once; fake server saw 0 `POST /api/shutdown` (test-plan #F2)
- [x] 8.4 Test (electron) restart sends graceful shutdown — exemplar `zombie-adoption.electron.spec.ts` (Take ownership → `/api/shutdown` assertion). input: fake health non-zombie `electron`, `bootParentAlive:false`, version ≠ manifest · trigger: launch, stub returns 0 · observable: fake server receives `POST /api/shutdown` with local-proof headers (test-plan #F4)
- [x] 8.5 Test (electron) matching versions attach silently — exemplar `tests/e2e-electron/tray-ownership.electron.spec.ts`. input: fake health non-zombie `electron`, version = manifest · trigger: launch without `--no-zombie-prompt` · observable: `showMessageBox` not called within 5 s of window load (test-plan #F5)
- [x] 8.6 Test (electron) test switch suppresses skew modals — exemplar `zombie-adoption.electron.spec.ts` (`--no-zombie-prompt` case). input: as 8.2 · trigger: launch with `--no-zombie-prompt` · observable: `showMessageBox` not called; app log has an `[attach-check]` line naming both versions (test-plan #F6)
- [x] 8.7 Update `tests/e2e-electron/AGENTS.md` rows for the touched/new specs.

## 9. Docs and integration

- [x] 9.1 Delegate a short caveman-style note on the attach-arm version-skew check (expected-runtime peek, modal matrix, graceful restart, dismissal file) to DocScribe for `docs/electron-bootstrap-flow.md`; verify the rows/prose land.
- [x] 9.2 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`; both green.
- [ ] 9.3 Manual: on macOS, leave a server started by an older app build running, install the newer build, launch, choose Restart in the merged modal; confirm `/api/health.version` is the new version and the Gmail plugin no longer shows "Failed to load" (test-plan: manual-only, #M1)
- [ ] 9.4 Manual: attach to a standalone server of another version with expected ≠ shell; check the info modal copy and disclosure line read clearly (test-plan: manual-only, #M2)

## Workflow follow-up

- Ship via `ship-it` in the worktree; archive syncs the four delta specs.
