## MODIFIED Requirements

### Requirement: Electron bootstrap state machine SHALL contain at most six states

The Electron main process bootstrap flow (`packages/electron/src/main.ts` and helpers in `packages/electron/src/lib/`) SHALL implement a state machine with **six states**: `checking-server-health`, `attach`, `wizard-welcome`, `launch-server`, `health-wait`, `loading-page-error`. Terminal end states: `attach` (running server reused) and `done` (bundled server spawned). No `preflight-inventory`, `silent-install`, `reinstall-managed`, `force-reinstall`, `version-skew-banner`, `wizard-select`, or `wizard-progress` states SHALL exist.

This requirement replaces the prior 12-state machine documented in `docs/electron-bootstrap-flow.md`. The collapse follows from the elimination of runtime npm install — there is no install or reconcile work for the bootstrap to manage, so the corresponding states have no purpose.

#### Scenario: First launch on a fresh machine

- **GIVEN** `~/.pi/dashboard/first-run-done` marker file does not exist
- **AND** no dashboard server is running on the configured port
- **WHEN** the Electron app is launched
- **THEN** the state machine SHALL traverse `checking-server-health` → `wizard-welcome` → `launch-server` → `health-wait` → `done`
- **AND** the marker file SHALL be written on transition into `done`
- **AND** no `installStandalone`, `preflight-reconcile`, or `installable.json` read SHALL occur

#### Scenario: Second launch with running server

- **GIVEN** a dashboard server is running on the configured port
- **WHEN** the Electron app is launched
- **THEN** the state machine SHALL traverse `checking-server-health` → `attach`
- **AND** the main window SHALL load the discovered `serverUrl`
- **AND** no spawn, install, or reconcile SHALL occur

#### Scenario: Second launch with no running server

- **GIVEN** `~/.pi/dashboard/first-run-done` exists
- **AND** no server is running
- **WHEN** the Electron app is launched
- **THEN** the state machine SHALL traverse `checking-server-health` → `launch-server` → `health-wait` → `done`
- **AND** the wizard SHALL be skipped

#### Scenario: Server spawn fails health-wait timeout

- **GIVEN** the bundled server fails to bind within the health-wait window
- **WHEN** `health-wait` exits via timeout
- **THEN** the state machine SHALL transition to `loading-page-error`
- **AND** the loading page SHALL surface `[Start server]`, `[Open Doctor]`, server-log tail, and known-servers list
- **AND** no `[Reinstall managed packages]` or `[Force reinstall]` button SHALL be rendered
