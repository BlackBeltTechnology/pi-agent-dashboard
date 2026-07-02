## MODIFIED Requirements

### Requirement: Global config read distinguishes CLI failure from empty profile

The global OpenSpec config read (`GET /api/openspec/config` and its `configListOrAsync` backing) SHALL distinguish a CLI-read failure from a genuinely empty/custom profile. A failed `openspec config list` spawn SHALL NOT be silently unwrapped into a `{ profile: "custom", workflows: [] }` payload. The Settings panel SHALL be able to render a distinct "couldn't read OpenSpec config" error state rather than a fake-empty profile that presents as "not found."

#### Scenario: CLI read failure surfaces as an error state

- **WHEN** `openspec config list --json` fails to execute (e.g. exit 127 because the interpreter is unresolvable, or any non-zero exit / spawn error)
- **THEN** the config read SHALL report a failure signal distinct from a successful empty result
- **AND** the Settings panel SHALL render an error state ("couldn't read OpenSpec config"), NOT an empty `custom` profile with zero workflows

#### Scenario: Successful read still maps expanded alias

- **WHEN** `openspec config list --json` succeeds and returns `profile: "custom"` with exactly the expanded workflow set
- **THEN** the read SHALL continue to surface the `expanded` alias to the Settings UI as before
