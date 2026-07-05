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

## 2. Validate on CI (post-merge — the workflow must be on the default branch first)

- [ ] 2.1 After this change (and the `ci-e2e-electron.yml` workflow) lands on `develop`, dispatch `ci-e2e-electron.yml` (`gh workflow run ci-e2e-electron.yml --ref develop`).
- [ ] 2.2 Confirm the `ubuntu-latest` leg (xvfb) passes all five specs green.
- [ ] 2.3 Confirm the `windows-latest` leg passes — in particular the win32 `decideIsZombie` branch fires in the real app (the zombie spec) and the tray/doctor specs render.
- [ ] 2.4 Confirm the `job-object-windows` job passes (`taskkill /F` cascade), or classify an `INFRA` result and adjust the boot path.

## 3. Stabilize (only if CI surfaces flakiness)

- [ ] 3.1 If the dialog/Menu stub loses the install-vs-attach-arm race, widen the `FakeHealthServer` health delay (no production test seams). Invoke `systematic-debugging` to root-cause from run logs, not guesses.
- [ ] 3.2 If `:8000` contention or packaged-boot timing flakes, add an explicit pre-run port/health check and/or raise the per-test timeout.
- [ ] 3.3 Re-run until two consecutive fully-green matrix runs demonstrate stability.

## 4. Cadence decision + wiring

- [ ] 4.1 Invoke `doubt-driven-review` on the CI-minutes-vs-signal trade-off (dispatch-only vs `pull_request` path-filter vs nightly `schedule`).
- [ ] 4.2 Wire the chosen trigger into `ci-e2e-electron.yml` (recommended default: `pull_request` path-filter on `packages/electron/**` + `tests/e2e-electron/**`, kept advisory / not a required check).
- [ ] 4.3 Update `.github/workflows/AGENTS.md` (workflow row) + a one-line note in `docs/` describing the cadence + advisory status.

## 5. Verification

- [ ] 5.1 Two consecutive green matrix runs on `develop`.
- [ ] 5.2 `openspec change validate run-electron-e2e-native-surface` passes.
- [ ] 5.3 Archive this change once the suite is green + the cadence is wired.
