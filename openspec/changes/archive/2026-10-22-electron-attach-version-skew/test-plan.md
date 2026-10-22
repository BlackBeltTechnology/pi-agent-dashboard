# Test Plan — electron-attach-version-skew

Stage: design   Generated: 2026-10-21

Levels: `L1` = vitest (`packages/electron/src/lib/__tests__/`, `packages/shared/src/__tests__/`); `electron` = Playwright `_electron` suite (`tests/e2e-electron/*.electron.spec.ts`, stubbed `dialog.showMessageBox`, fake `/api/health`). Times assume injected clocks/sleeps in L1.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shell: Attach-time skew check | decision-table | L1 | automated | health `{version:"0.10.0", launchSourceEffective:"electron"}`, expected `0.10.0`, packaged | `decideAttachAction()` | `{action:"none"}` |
| E2 | shell: Cosmetic version differences | EP | L1 | automated | server `" v0.10.0 "`, expected `0.10.0` | `decideAttachAction()` | `none` |
| E3 | shell: Attach-time skew check (unknown) | EP | L1 | automated | server version `"unknown"`, then `""`, then absent; expected `0.10.0`; electron | `decideAttachAction()` ×3 | `none` all three |
| E4 | shell: Development and local-link runtimes | decision-table | L1 | automated | expected `null` (devMonorepo / localLink / unreadable manifest), server `0.9.0` | `decideAttachAction()` | `none` |
| E5 | shell: Development and local-link runtimes | decision-table | L1 | automated | `isPackaged:false`, server `0.9.0`, expected `0.10.0` | `decideAttachAction()` | `none` |
| E6 | shell: Skewed Electron-launched server is offered a restart | decision-table | L1 | automated | electron, non-zombie, `bootParentAlive:false`, `0.9.0` vs `0.10.0` | `decideAttachAction()` | `skew-restart`, `restartIsDefault:true` |
| E7 | shell: Live or unknown owner makes Leave running the default | decision-table | L1 | automated | as E6 but `bootParentAlive:true`; then field absent | `decideAttachAction()` ×2 | `skew-restart`, `restartIsDefault:false` both |
| E8 | shell: Zombie that is also skewed shows one merged modal | decision-table | L1 | automated | `isZombie:true`, `0.9.0` vs `0.10.0` | `decideAttachAction()` | `skew-zombie-merged` |
| E9 | shell: Zombie with matching version keeps the three-button modal | decision-table | L1 | automated | `isZombie:true`, versions equal; then expected `null` | `decideAttachAction()` ×2 | `zombie` both |
| E10 | shell: Skewed externally launched server gets a notice | decision-table | L1 | automated | launch source `standalone`, `bridge`, `bridge-orphaned`, absent, `"weird"`; `0.9.0` vs `0.10.0` | `decideAttachAction()` ×5 | `skew-info` all five; never `skew-restart` |
| E11 | shell: Dismissed version pair stays quiet | decision-table | L1 | automated | dismissal `{0.9.0, 0.10.0, standalone}` stored | evaluate standalone `0.9.0`/`0.10.0`; bridge same pair; standalone `0.9.0`/`0.10.1` | `none`; `skew-info`; `skew-info` |
| E12 | launch-source: Bundle is the expected runtime | EP | L1 | automated | fixture: bundle manifest `0.10.0`, no overlays | `resolveExpectedRuntime()` | `{source:"bundled", version:"0.10.0"}` |
| E13 | launch-source: Active overlay is the expected runtime | EP | L1 | automated | bundle `0.10.0` + compatible overlay `0.10.1` committed | `resolveExpectedRuntime()` | `{source:"overlay", version:"0.10.1"}` |
| E14 | launch-source: Incompatible overlay skipped without recording | state-transition | L1 | automated | overlay whose `minShellVersion` > shell | `resolveExpectedRuntime()` | resolves `bundled`; `state.json` + `request.json` bytes identical before/after |
| E15 | launch-source: Exhausted pending runtime resolved but not persisted | state-transition | L1 | automated | `request.pending = X`, `state.attempts[X]` at max, uncommitted | `resolveExpectedRuntime()` | X skipped; files byte-identical; a following `planColdLaunch()` marks X bad (proves peek ≠ persist) |
| E16 | launch-source: side-effect free (explicit update) | state-transition | L1 | automated | unconsumed explicit-update request on disk | `peekColdLaunch()` then `planColdLaunch()` on copies of same fixture | identical `inputs`; only `planColdLaunch` changes files |
| E17 | launch-source: Non-release source yields unknown | EP | L1 | automated | resolver returns `devMonorepo`; then `localLink`; then bundle without manifest | `resolveExpectedRuntime()` ×3 | `version:null` ×3 |
| E18 | shell: Expected-version failure is silent | fault-injection (abort) | L1 | automated | resolver throws `BundledServerMissingError`; then `PinnedSourceUnavailableError` | `resolveExpectedRuntime()` | returns `version:null`, no throw |
| E19 | shell: dismissal persistence (D7) | BVA | L1 | automated | dismissal file absent / corrupt JSON / 19, 20, 21 pairs / duplicate pair | `addDismissedVersionSkew()` + read | absent/corrupt → `[]`; 21st evicts oldest, length 20; duplicate not re-added; written via tmp+rename |
| E20 | shell: Dismissal does not affect first-run detection | state-transition | L1 | automated | temp HOME with no `dashboard-settings.json` | `addDismissedVersionSkew()` | `dashboard-settings.json` absent; `isFirstRun()` still `true` |
| E21 | doctor-diagnostic (unchanged output) | EP | L1 | automated | launch sources `standalone`, `bridge`, `bridge-orphaned`, `electron`, absent; app `0.10.0` | `attachedServerVersionSuggestion()` + `checkAttachedServerVersion()` | suggestion strings equal today's literal strings; Doctor row output byte-identical to pre-change snapshot |
| E22 | shell: Fix text names the version it installs | EP | L1 | automated | info modal: shell `0.10.0`, expected `0.10.1`; then expected `0.10.0` | build info-modal detail | first contains "installs v0.10.0" and "v0.10.1"; second has no disclosure line |
| E23 | shell: dialog contracts (D5) | decision-table | L1 | automated | stubbed `dialog.showMessageBox` | `promptVersionSkewRestart({restartIsDefault:true/false})`, `promptMergedZombieSkew`, `promptVersionSkewInfo` | buttons/order: [Restart with v0.10.0, Leave running] default 0 / 1; [Restart with v0.10.0, Take ownership, Leave running] default 0, cancel = Leave running; [OK, Don't show again for this version pair] default 0; message contains `0.9.0` and `0.10.0` |
| E24 | shell: liveness rule via shared primitive (platform-primitives) | EP | L1 | automated | injected `kill` throwing `ESRCH`, then `EPERM`, then succeeding | `isProcessAlive(pid, {epermAlive:true})` and default `isProcessAlive(pid)` | opt-in: `false`, `true`, `true`; default: `false`, `false`, `true` (unchanged) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | shell: SHALL NOT delay opening the window | ordering invariant | L1 | automated | attach arm with `/api/health` fake delayed 3 s and `resolveExpectedRuntime` delayed 1 s | `createMainWindow` call recorded before the health fetch resolves (0 awaited ms on the evaluation path) | single launch |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | qa: Merged modal is reached for a skewed zombie | state-transition | electron | automated | fake health: zombie (`electron`, `bootParentAlive:false`, reparented `ppid`), `version` = manifest version with patch+1 | launch packaged app without `--no-zombie-prompt` | `showMessageBox` called exactly once; buttons `Restart with v<manifest>`, `Take ownership`, `Leave running` |
| F2 | qa: Informational modal never stops an external server | state-transition | electron | automated | fake health: `standalone`, different version | launch; stub returns OK (0) | info modal shown once; fake server log has 0 `POST /api/shutdown` |
| F3 | qa: Zombie fixture version follows the bundle | state-transition | electron | automated | existing zombie-adoption scenarios, fixture version read from bundled `runtime-manifest.json` | launch | three original adoption buttons still asserted; no merged modal |
| F4 | shell: Older Electron-launched server is offered a restart | state-transition | electron | automated | fake health: non-zombie `electron`, `bootParentAlive:false`, version ≠ manifest | launch; stub returns 0 (Restart) | fake server receives `POST /api/shutdown` carrying local-proof headers |
| F5 | shell: Matching versions attach silently | state-transition | electron | automated | fake health: non-zombie `electron`, version = manifest | launch without `--no-zombie-prompt` | `showMessageBox` not called within 5 s of window load |
| F6 | shell: Skew modals honour the test switch | state-transition | electron | automated | as F1 | launch with `--no-zombie-prompt` | `showMessageBox` not called; app log contains `[attach-check]` line naming both versions |
| M1 | proposal: field report (Gmail `oauth4webapi`) | exploratory | — | manual-only | macOS: server started by an older app build left running, newer build installed | launch newer build; choose Restart in merged modal | [judgment: real install end-to-end — `/api/health.version` = new version and Gmail plugin no longer shows "Failed to load"] |
| M2 | shell: informational modal copy | visual/subjective | — | manual-only | standalone server of another version, expected ≠ shell | launch packaged app | [judgment: modal copy is clear and the disclosure line reads correctly] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | shell: Graceful restart replaces the skewed server | state-transition | L1 | automated | none: PID 4242 reports `ESRCH` at t=1.0 s after `/api/shutdown` | `requestServerLaunch({force:true})` | no signal sent; spawner called once after `ESRCH`; returns `started` |
| X2 | shell: Force restart waits for the old process, not just the port | fault-injection (delay) | L1 | automated | port closes at t=0.2 s, PID alive until t=3 s | `requestServerLaunch({force:true})` | spawner not called before t=3 s; called after; no signal |
| X3 | shell: Unresponsive old server is escalated | BVA | L1 | automated | PID alive continuously for 5.0 s, dies 1 s after SIGTERM | `requestServerLaunch({force:true})` | SIGTERM sent at ≥5.0 s, no SIGKILL; spawn after `ESRCH` |
| X4 | supervision: Zombie that cannot be stopped / 2 s bound | BVA | L1 | automated | PID survives SIGTERM; after SIGKILL dies at 1.8 s; second run at 2.2 s | `stopZombieServer()` / force branch | 1.8 s → `true` and spawn; 2.2 s → `false`, force returns `failed`, spawner never called |
| X5 | shell: liveness rule (`EPERM` = alive) | EP | L1 | automated | `process.kill(pid,0)` throws `EPERM` throughout | force branch | treated as alive → escalation → `failed`; spawner never called |
| X6 | shell: Force restart never reports a surviving server as started | fault-injection (abort) | L1 | automated | PID gone, but a different server still answers the port | `requestServerLaunch({force:true})` | returns `failed` naming the surviving server; spawner not called; not `started` |
| X7 | shell: idempotent routine (shutdown POST fails) | fault-injection (abort) | L1 | automated | `/api/shutdown` fetch rejects; PID dies at t=0.5 s | `requestServerLaunch({force:true})` | still waits on PID; spawns after `ESRCH`; returns `started` |
| X8 | supervision: Stop a zombie (confirmed gone) | state-transition | L1 | automated | zombie Stop now; `stopZombieServer` returns `false` | zombie flow | notice dialog shown; `resolveAndSpawnRuntime` not called |
| X9 | shell: Changed identity aborts the restart | state-transition | L1 | automated | modal raised for PID 4242; re-fetch reports PID 5151 (or different `bootParentPid`) | user picks Restart | no `/api/shutdown`; notice "restart did not complete"; no signal |
| X10 | shell: Server already at the expected version is not restarted | state-transition | L1 | automated | re-fetch reports `version` = expected | user picks Restart | no `/api/shutdown`; "already up to date" notice |
| X11 | shell: A foreign server on the port is not adopted | fault-injection | L1 | automated | `started`, but health `pid` ≠ `getStoredSpawnedPid()` (or `launchSourceEffective:"standalone"`) | post-restart verification | recovery page shown; no success notice |
| X12 | shell: Runtime fallback is reported honestly | fault-injection | L1 | automated | promised `0.10.1`; new health reports `0.10.0` | post-restart verification | notice naming `v0.10.0` running instead of `v0.10.1` |
| X13 | shell: restart launch failure | fault-injection (abort) | L1 | automated | `requestServerLaunch` returns `failed` after old PID gone | restart flow | outcome notice + `showServerRecovery()` called once |
| X14 | shell: Leave running / OK suppress for this lifetime only | state-transition | L1 | automated | user picks Leave running (restart modal) / OK (info modal) | second `evaluateAttachedServer()` same lifetime; fresh evaluator (new lifetime) | no dialog second time; dialog again in new lifetime |
| X15 | shell: health unreachable | fault-injection (abort) | L1 | automated | `/api/health` fetch rejects / non-200 | `evaluateAttachedServer()` | no dialog, no throw, `[attach-check]` log reason `health-unreachable` |

---

## Coverage summary

- Requirements covered: 17/17 delta requirements (launch-source 3, shell 8 incl. 2 MODIFIED, supervision 1 MODIFIED, qa 1 ADDED, plus doctor-diagnostic regression)
- Scenarios by class: edge 24 · perf 1 · frontend 8 · error 15
- Scenarios by level: L1 40 · electron 6 · — 2
- Scenarios by disposition: automated 46 · manual-only 2

## New infra needed

- none. The L1 orchestration rows (X9–X15, P1) need `evaluateAttachedServer` in an injectable module under `packages/electron/src/lib/` rather than inline in `main.ts`, following the `server-lifecycle.ts` deps pattern.
