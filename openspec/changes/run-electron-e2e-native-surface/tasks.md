# Tasks

## 1. Harness + specs + workflow (DELIVERED in `electron-attach-ownership-fixes`)

- [x] 1.1 `tests/e2e-electron/electron-lifecycle.ts` — `_electron.launch` against the packaged binary (per-OS resolver), `FakeHealthServer` (crafted `/api/health`, health-response delay, records `POST /api/shutdown`), `makeThrowawayHome` (port-pinned config + first-run marker), `stubDialog`/`readDialogCalls`, `captureMenuTemplates`/`readMenuTemplates`, `isPortInUse` skip guard.
- [x] 1.2 `playwright.electron.config.ts` (separate from the Docker web-client config; no Docker globalSetup) + `npm run test:e2e:electron` (+ `pretest:e2e:electron` packages the app).
- [x] 1.3 `tests/e2e-electron/zombie-adoption.electron.spec.ts` — modal reached with PID; `--no-zombie-prompt` suppresses; Take-ownership → quit POSTs `/api/shutdown`.
- [x] 1.4 `tests/e2e-electron/doctor-version-skew.electron.spec.ts` — opens the doctor window via `#doctor-btn`, asserts the WARN "Attached server version" row + npm-upgrade suggestion.
- [x] 1.5 `tests/e2e-electron/tray-ownership.electron.spec.ts` — monkeypatches `Menu.buildFromTemplate`, asserts the disabled "Server managed externally" row and no "Restart server".
- [x] 1.6 `scripts/windows-job-object-smoke.ts` — spawn-mode launch, `taskkill /F` the parent, assert the server dies + `:8000` frees; `INFRA` vs `FAIL` signals.
- [x] 1.7 `.github/workflows/ci-e2e-electron.yml` — matrix `os: [ubuntu-latest, windows-latest]` (`fail-fast: false`), Linux under `xvfb`, Windows direct; separate `job-object-windows` job; `workflow_dispatch`.
- [x] 1.8 Prerequisite unblocks landed: koffi Windows Tier-2 smoke green (`_smoke.yml`, `tier=tier2` confirmed) and the colon-named-path Windows-checkout bug removed (#239 merged).

## 2. Validate on CI (dispatched on this branch = develop + this change)

- [x] 2.1 Dispatched `ci-e2e-electron.yml` on the change branch (the workflow is on `develop` from #238; runs check out this branch with the stabilization fixes).
- [x] 2.2 `ubuntu-latest` leg (xvfb) passes all five specs green (run 28725992873).
- [x] 2.3 `windows-latest` leg passes — the win32 `decideIsZombie` branch fires in the real app, and the tray/doctor specs render (green across runs 28725527239, 28725689864, 28725856525, 28725992873).
- [x] 2.4 `job-object-windows` classified: `INFRA` (a lightweight `electron-forge package` on a GHA runner does not boot the app's full spawn path). Made advisory (`continue-on-error`); deep real-launch cascade validation belongs in the qa VM smoke (`qa/tests`, cf. `08-electron-real-launch.sh`).

## 3. Stabilize (CI surfaced real issues — all fixed)

- [x] 3.1 Doctor spec: the loading page redirects to the healthy fake server, discarding the transient `#doctor-btn` — open the Doctor window via the `dashboard:open-doctor` IPC (`openDoctorViaIpc`) instead. Zombie "take ownership": `app.close()` does not run the graceful-quit shutdown — assert the adoption via the observable tray flip to `electron`-owned.
- [x] 3.2 Tray spec: the 1200 ms fake-health delay exceeded `getServerOwnership`'s 1 s fetch timeout → `"unknown"`; lowered to 600 ms. Ubuntu launch: fixed the Linux binary resolver (was grabbing `chrome-sandbox`, not `pi-dashboard`) + `--no-sandbox` + `playwright install-deps` + AppArmor userns sysctl.
- [x] 3.3 Two consecutive fully-green matrix runs (both `electron-e2e` legs) achieved (28725992873 + confirmation run).

## 4. Cadence decision + wiring

- [x] 4.1 `doubt-driven-review` applied: the choice is reversible (remove trigger), low-stakes (advisory — no branch-protection gate), and bounded (path-filtered to electron-touching PRs). Flaky-E2E risk mitigated by the deterministic stabilization fixes.
- [x] 4.2 Wired `pull_request` path-filter (`packages/electron/**`, `tests/e2e-electron/**`, `playwright.electron.config.ts`, the workflow itself) + `workflow_dispatch` into `ci-e2e-electron.yml`. Advisory (not required); `job-object-windows` is `continue-on-error`.
- [x] 4.3 Updated `.github/workflows/AGENTS.md` (workflow row) + a one-line docs note describing the cadence + advisory status.

## 5. Verification

- [x] 5.1 Two consecutive green matrix runs (both `electron-e2e` legs; `job-object-windows` advisory).
- [x] 5.2 `openspec change validate run-electron-e2e-native-surface` passes.
- [ ] 5.3 Archive this change once merged (the suite is green + the cadence is wired).
