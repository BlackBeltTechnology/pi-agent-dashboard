## MODIFIED Requirements

### Requirement: Section taxonomy on every check
Every `DoctorCheck` SHALL carry a `section` field whose value is one of `runtime`, `pi-tooling`, `server`, `tunnel`, `setup`, or `diagnostics`. The mapping from check name to section SHALL be defined in a single shared table consumed by every renderer.

#### Scenario: Runtime checks are tagged runtime
- **WHEN** the doctor produces checks named `Electron`, `System Node.js`, `Bundled Node.js`, or `Bundled npm`
- **THEN** each of those checks SHALL have `section: "runtime"`

#### Scenario: pi-tooling checks are tagged pi-tooling
- **WHEN** the doctor produces checks named `pi CLI` or `openspec CLI`
- **THEN** each of those checks SHALL have `section: "pi-tooling"`

#### Scenario: Server-related checks are tagged server
- **WHEN** the doctor produces checks named `Dashboard server code`, `Offline packages bundle`, `TypeScript loader`, `Dashboard server`, `Server log (~/.pi-dashboard/server.log)`, or `Server launch test`
- **THEN** each of those checks SHALL have `section: "server"`

#### Scenario: Tunnel checks are tagged tunnel
- **WHEN** the doctor produces checks named `zrok binary`, `zrok environment`, `zrok API reachable`, or `tunnel runtime`
- **THEN** each of those checks SHALL have `section: "tunnel"`

#### Scenario: Setup checks are tagged setup
- **WHEN** the doctor produces checks named `Setup wizard` or `API key`
- **THEN** each of those checks SHALL have `section: "setup"`

#### Scenario: Legacy-install-directory advisory is tagged diagnostics
- **WHEN** the doctor produces the `Legacy install directory` row
- **THEN** that check SHALL have `section: "diagnostics"`

