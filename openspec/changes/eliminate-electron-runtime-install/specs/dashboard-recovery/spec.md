## MODIFIED Requirements

### Requirement: Loading page SHALL offer only diagnostic and retry actions

`packages/electron/src/renderer/loading.html` SHALL render when the server is unreachable. It SHALL contain exactly these affordances: `[Start server]` (retry spawn), `[Open Doctor]`, a server-log tail panel, and a known-servers list. No `[Reinstall managed packages]` button, no `[Force reinstall]` button, no Advanced disclosure with install actions, and no inventory diagnostic panel SHALL be rendered. No `dashboard:check-inventory`, `dashboard:reinstall-managed`, `dashboard:force-reinstall`, or `dashboard:install-progress` IPC channels SHALL exist.

This requirement reflects the elimination of every reinstall code path. Recovery for a broken installation is now `electron-updater` (whole-`.app` replacement) or manual via Doctor diagnostics + Settings → Tools.

#### Scenario: Loading page on health timeout

- **GIVEN** the bundled server fails to start within the health-wait window
- **WHEN** the state machine transitions to `loading-page-error`
- **THEN** `loading.html` SHALL render with `[Start server]`, `[Open Doctor]`, server-log tail, known-servers list
- **AND** no reinstall-related button SHALL be visible
- **AND** no inventory diagnostic call SHALL fire

#### Scenario: Loading page server-log tail

- **GIVEN** the loading page is rendered
- **WHEN** the page mounts
- **THEN** it SHALL read the tail of `getDashboardServerLogPath()` (`~/.pi/dashboard/server.log`)
- **AND** it SHALL NOT read the installer log (`~/.pi-dashboard/server.log`)

#### Scenario: Loading page retry

- **GIVEN** the loading page is rendered after a spawn failure
- **WHEN** the user clicks `[Start server]`
- **THEN** the IPC SHALL invoke `requestServerLaunch({ force: true })`
- **AND** the state machine SHALL re-enter `launch-server`
- **AND** no install or reconcile SHALL be invoked between retries
