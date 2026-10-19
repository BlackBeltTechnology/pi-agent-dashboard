# Spec Delta

## MODIFIED Requirements

### Requirement: Native-surface Electron flows are covered by a CI Playwright-`_electron` suite

The QA suite SHALL include a Playwright-`_electron` suite (`tests/e2e-electron/`, config `playwright.electron.config.ts`) that launches the **real packaged Electron app** and verifies the native-surface behaviours of attach-mode ownership that unit tests, the web-client Docker E2E, and CDP cannot reach: the zombie-adoption modal, the Doctor version-skew row, and the tray "Server managed externally" row. Windows Job Object kill-on-close (the spawned server dying with a force-killed Electron parent) is NOT covered by this suite or by any other automated test; only its `detach: false` spawn precondition is pinned by a unit test.

The suite SHALL run in CI via `.github/workflows/ci-e2e-electron.yml` across a matrix of `ubuntu-latest` (under `xvfb`), `windows-latest` (direct) and `macos-latest` (direct), with `fail-fast: false`, so no supported desktop platform's native-surface path is left unexecuted. Native modals and menus cannot be clicked or read back by automation; the suite SHALL instead stub `dialog.showMessageBox` / `Menu.buildFromTemplate` in the main process (via `electronApp.evaluate`) and assert the flow reaches them with the correct arguments and that each returned choice drives the documented outcome.

The macOS leg SHALL NOT run on a `pull_request` run, because GitHub-hosted macOS runner minutes bill at a multiple of Linux minutes and this suite is advisory. The matrix SHALL depend on the triggering event name only (`github.event_name`, defined for every event), never on pull-request payload fields: `workflow_dispatch` runs all three OSes; a nightly `schedule` runs the macOS leg only — every other job in the workflow (today `runtime-overlay-e2e`, and any job added later) SHALL carry a job-level gate that skips it on `schedule`, so no scheduled Linux, Windows or runtime-overlay run is added; `pull_request` runs Linux and Windows only. The workflow's `pull_request` activity types SHALL remain the defaults (no `labeled`), so a label change never starts or cancels a run. Any branch — including an Electron major-version bump branch — obtains a macOS run through `workflow_dispatch` against that branch. The Linux and Windows legs SHALL keep their existing cadence.

Every OS the matrix admits SHALL have a step that runs the `_electron` suite on that OS; a leg that packages the app but runs no spec is a defect. A repo-lint test SHALL assert, for each OS literal in every branch of the matrix expression, that at least one suite-running step's `if:` admits that OS.

The macOS leg packages and runs the app on the same runner, so the runner architecture matches the binary by construction; it SHALL run on `macos-latest` (arm64) with no x64 twin. Like the other `electron-e2e` matrix legs it SHALL NOT be `continue-on-error`: "advisory" here means not a required status check, so a darwin regression turns the run red without blocking a merge.

A spec in this suite that fails on one platform for a product defect SHALL be quarantined for that platform with the project's `fixme`-with-issue-link convention, at the narrowest scope that keeps the platform's other tests running, rather than left red or deleted. While a quarantine stands, the workflow SHALL state which spec that platform's green does not cover. A quarantine SHALL be removed in the change that fixes its issue, and SHALL be re-evaluated on every Electron major-version bump.

The suite MAY remain `workflow_dispatch`-only OR be promoted to an automatic trigger (a `pull_request` path-filter on `packages/electron/**` + `tests/e2e-electron/**`, or a nightly `schedule`); the chosen cadence SHALL be recorded. Until stability across several runs is demonstrated the suite SHALL remain advisory (not a required merge check).

#### Scenario: Zombie-adoption modal is reached with the leftover PID

- **GIVEN** the packaged app is launched attached to a fake `/api/health` reporting `launchSourceEffective: "electron"`, `bootParentAlive: false`, a reparented `ppid`, and no `storedSpawnedPid`
- **WHEN** the attach arm runs on any OS leg where the spec is not quarantined
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

#### Scenario: Suite is dispatchable only once the workflow is on the default branch

- **GIVEN** `ci-e2e-electron.yml` is present on the repository default branch
- **WHEN** the workflow is dispatched (`workflow_dispatch`) or triggered by the chosen cadence
- **THEN** every matrix leg the triggering event admits SHALL run (a feature-branch-only workflow returns HTTP 404 on dispatch and cannot run)

#### Scenario: The darwin native-surface path executes in CI

- **WHEN** the workflow is dispatched or the nightly schedule fires
- **THEN** a macOS leg SHALL package the app and run the `_electron` suite on macOS
- **AND** its result SHALL be reported per spec, so a darwin-only regression is visible without a local macOS machine

#### Scenario: An electron-only PR does not pay for a macOS runner

- **GIVEN** a pull request touching `packages/electron/**`
- **WHEN** the path filter triggers the workflow
- **THEN** the Linux and Windows legs SHALL run
- **AND** no macOS leg SHALL run

#### Scenario: A label change neither starts nor cancels a run

- **GIVEN** an in-flight Electron E2E run for a pull request
- **WHEN** any label is added to that pull request
- **THEN** no Electron E2E run SHALL be created for the label event
- **AND** the in-flight run SHALL NOT be cancelled

#### Scenario: Every matrix OS executes the suite

- **WHEN** the macOS leg runs
- **THEN** a step SHALL run the `_electron` suite on macOS
- **AND** the repo-lint test SHALL fail if any OS the matrix can produce has no admitting suite-running step

#### Scenario: The nightly schedule runs macOS only

- **WHEN** the nightly schedule fires
- **THEN** the macOS leg SHALL run
- **AND** no Linux, Windows or runtime-overlay leg — nor any other job of the workflow — SHALL run
- **AND** the repo-lint test SHALL fail if any job other than the macOS matrix leg lacks a gate that skips it on `schedule`

#### Scenario: A platform-specific product defect is quarantined, not left red

- **GIVEN** a native-surface spec that hangs or fails on one platform because of a product defect tracked by an issue
- **WHEN** the suite runs on that platform
- **THEN** the spec SHALL report as a `fixme` skip carrying the issue URL
- **AND** the platform's other native-surface specs SHALL still run and report verdicts
- **AND** the workflow SHALL state that the platform's green does not cover the quarantined spec
