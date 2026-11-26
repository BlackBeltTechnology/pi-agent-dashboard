## RENAMED Requirements

- FROM: `### Requirement: Capture pi session output toggle in General tab`
- TO: `### Requirement: Capture pi session output toggle in Developer section`

## MODIFIED Requirements

### Requirement: Capture pi session output toggle in Developer section
The Settings panel SHALL render a "Capture pi session output (debug)" toggle in the Developer section, alongside the diagnostic tooling (`DiagnosticsSection` / `ToolsSection` / `SpawnFailuresSection`). The toggle SHALL be bound to `config.keeperLog.capturePiOutput` and SHALL default to off when the field is absent. Changes SHALL be included in the save diff and persisted via the config write endpoint.

The toggle's help text SHALL state three things:
- when on, each session's keeper lifecycle and full pi stdout/stderr are archived into `keeper-<id>.log` for debugging and consume disk;
- when off, new sessions write no keeper log files at all;
- the setting applies to new sessions only.

The help text SHALL be localized for every shipped locale (en, hu, zh-CN) and SHALL follow the user-facing copy rule ("new session", never "spawn").

#### Scenario: Toggle reflects current config
- **WHEN** the Developer section renders with `config.keeperLog.capturePiOutput === false` (or absent)
- **THEN** the "Capture pi session output (debug)" toggle SHALL be off

#### Scenario: Toggling on persists to config
- **WHEN** the user enables the toggle and saves
- **THEN** the save diff SHALL include `keeperLog.capturePiOutput: true`
- **AND** the config write endpoint SHALL persist the value

#### Scenario: Toggle placed with diagnostic tools
- **WHEN** the Developer settings section is displayed
- **THEN** the toggle SHALL appear in the same region as the diagnostics sections, not under an unrelated section

#### Scenario: Help text states off disables all keeper logs
- **WHEN** the toggle renders in any shipped locale
- **THEN** its help text SHALL state that, when off, new sessions write no keeper log files
