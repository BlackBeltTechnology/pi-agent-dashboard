# electron-qa-coverage — delta

## ADDED Requirements

### Requirement: Native-surface Electron flows are covered by a CI Playwright-`_electron` suite

The QA suite SHALL include a Playwright-`_electron` suite (`tests/e2e-electron/`, config `playwright.electron.config.ts`) that launches the **real packaged Electron app** and verifies the native-surface behaviours of attach-mode ownership that unit tests, the web-client Docker E2E, and CDP cannot reach: the zombie-adoption modal, the Doctor version-skew row, the tray "Server managed externally" row, and (Windows) Job Object kill-on-close.

The suite SHALL run in CI via `.github/workflows/ci-e2e-electron.yml` across a matrix of `ubuntu-latest` (under `xvfb`) and `windows-latest` (direct), with `fail-fast: false`. Native modals and menus cannot be clicked or read back by automation; the suite SHALL instead stub `dialog.showMessageBox` / `Menu.buildFromTemplate` in the main process (via `electronApp.evaluate`) and assert the flow reaches them with the correct arguments and that each returned choice drives the documented outcome.

The suite MAY remain `workflow_dispatch`-only OR be promoted to an automatic trigger (a `pull_request` path-filter on `packages/electron/**` + `tests/e2e-electron/**`, or a nightly `schedule`); the chosen cadence SHALL be recorded. Until stability across several runs is demonstrated the suite SHALL remain advisory (not a required merge check).

#### Scenario: Zombie-adoption modal is reached with the leftover PID

- **GIVEN** the packaged app is launched attached to a fake `/api/health` reporting `launchSourceEffective: "electron"`, `bootParentAlive: false`, a reparented `ppid`, and no `storedSpawnedPid`
- **WHEN** the attach arm runs on either OS leg
- **THEN** the stubbed `dialog.showMessageBox` SHALL be called with the three adoption buttons AND the detail text SHALL contain the zombie server's PID
- **AND** with `--no-zombie-prompt` the dialog SHALL NOT be called
- **AND** choosing "Take ownership" then quitting SHALL POST `/api/shutdown` to the adopted server

#### Scenario: Doctor version-skew row renders in the doctor window

- **GIVEN** the packaged app is launched attached to a fake `/api/health` whose `version` differs from the app version, with `launchSource: "standalone"`
- **WHEN** the loading page's "Open Doctor" control opens the doctor window
- **THEN** the "Attached server version" row SHALL render with a WARN status AND a suggestion containing `npm i -g @blackbelt-technology/pi-dashboard@`

#### Scenario: Tray builds the disabled foreign row, never Restart

- **GIVEN** the packaged app is launched attached to any reachable fake server (attach arm ⇒ `storedSpawnedPid === null` ⇒ ownership `"foreign"`)
- **WHEN** the tray ownership poll rebuilds the menu
- **THEN** a built `Menu.buildFromTemplate` template SHALL contain a disabled "Server managed externally" item AND SHALL NOT contain a "Restart server" item

#### Scenario: Windows Job Object cascades a forced parent kill

- **GIVEN** `windows-latest` with `:8000` free, and the packaged app launched in spawn mode so it spawns a real server via `spawnDetached({ detach: false })`
- **WHEN** the Electron parent is force-killed with `taskkill /F /PID <electron-pid>` (no `/T`)
- **THEN** the spawned server PID SHALL die AND `:8000` SHALL free within the timeout (`KILL_ON_JOB_CLOSE` fired)
- **AND** a server-never-booted setup failure SHALL be reported as `INFRA` distinctly from an invariant break reported as `FAIL`

#### Scenario: Suite is dispatchable only once the workflow is on the default branch

- **GIVEN** `ci-e2e-electron.yml` is present on the repository default branch
- **WHEN** the workflow is dispatched (`workflow_dispatch`) or triggered by the chosen cadence
- **THEN** both matrix legs SHALL run (a feature-branch-only workflow returns HTTP 404 on dispatch and cannot run)
