## ADDED Requirements

### Requirement: A project's settings can only tighten the guard

The project settings layer (trusted project only) SHALL only raise `mode` along `off < warn < strip < block`, add names to `untrustedTools` and `sensitiveTools` and set `taintScope` to `session`; it SHALL NOT lower the mode, remove names, add `allowHosts` or relax `taintScope`. An ignored lowering field SHALL be logged by name (no value) once per load; no-op or invalid fields SHALL NOT be logged.

#### Scenario: Project cannot switch the guard off
- **GIVEN** the user layer sets no mode and a trusted project sets `mode: "off"`
- **WHEN** settings are resolved
- **THEN** the effective mode SHALL be `strip` and one log line SHALL name `mode`

#### Scenario: Project can raise the mode
- **WHEN** a trusted project sets `mode: "block"`
- **THEN** the effective mode SHALL be `block`

#### Scenario: Project cannot narrow the sensitive set
- **WHEN** a trusted project sets `sensitiveTools: ["foo"]`
- **THEN** the effective set SHALL be the user layer's set plus `foo`

#### Scenario: Project cannot widen the allowed image hosts
- **WHEN** a trusted project sets `allowHosts: ["evil.example"]`
- **THEN** `evil.example` SHALL NOT be in the effective allowlist

#### Scenario: User layer is unaffected
- **WHEN** the user's `<agentDir>/settings.json` sets `mode: "warn"`
- **THEN** the effective mode SHALL be `warn`

#### Scenario: A no-op project field is silent
- **WHEN** a trusted project sets `mode: "strip"` over an effective `strip`, or `sensitiveTools: []`
- **THEN** no line SHALL be logged and the effective settings SHALL be unchanged

#### Scenario: A relaxing taint scope is ignored and logged once per load
- **GIVEN** the user layer sets `taintScope: "session"` and a trusted project sets `taintScope: "run"`
- **WHEN** settings are loaded twice
- **THEN** the effective scope SHALL be `session` and one line naming `taintScope` SHALL be logged per load
