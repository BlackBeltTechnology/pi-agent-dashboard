## ADDED Requirements

### Requirement: /api/health exposes the active runtime

`GET /api/health` SHALL include a `runtime` object with `origin` (`bundled` | `overlay` | `local` | `devMonorepo` | `npmGlobal`), `version`, `updatable`, and, when applicable, `source`, `channel`, `gitSha`, `dirty`, `piVersion` and `lastFailure`. `updatable` SHALL mean "runtime overlay updates are available" and SHALL be true only when the Electron app started the server and the origin is not `devMonorepo`. `updatable` SHALL NOT change the visibility of existing per-package pi-core update controls.

#### Scenario: Electron on bundled runtime

- **WHEN** Electron launched the bundled runtime AND source is `bundled`
- **THEN** `runtime.origin` SHALL be `bundled` AND `runtime.updatable` SHALL be `true`

#### Scenario: Electron on overlay

- **WHEN** Electron launched overlay runtime X
- **THEN** `runtime.origin` SHALL be `overlay` AND `runtime.version` SHALL be X

#### Scenario: Standalone server

- **WHEN** the server was started standalone
- **THEN** `runtime.origin` SHALL be `npmGlobal` AND `runtime.updatable` SHALL be `false`

#### Scenario: Existing pi-core controls unchanged

- **WHEN** Electron runs any runtime origin
- **THEN** the per-package pi-core update controls SHALL remain hidden exactly as before this change

#### Scenario: Last activation failed

- **WHEN** the most recent overlay activation was rolled back
- **THEN** `runtime.lastFailure` SHALL contain the version and reason

#### Scenario: Older client

- **WHEN** a client that does not know the `runtime` field reads `/api/health`
- **THEN** all pre-existing fields SHALL be present and unchanged

### Requirement: Electron routes runtime and shell updates separately

With the Electron starter, updates to the dashboard runtime SHALL go through the runtime overlay, and updates to the shell (Electron + bundled Node) SHALL go through the in-app whole-app updater. A runtime that requires a newer shell SHALL direct the user to the whole-app update.

#### Scenario: Runtime update available

- **WHEN** a newer runtime release exists on the selected channel AND the shell satisfies its minimum shell version
- **THEN** the UI SHALL offer a runtime update without an app update

#### Scenario: Runtime needs newer shell

- **WHEN** the newest runtime release requires a newer shell
- **THEN** the UI SHALL offer the whole-app update instead
