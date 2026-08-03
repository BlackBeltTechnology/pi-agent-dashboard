## ADDED Requirements

### Requirement: Streaming bash_execution_update forwarding with terminal fallback

When the pi runtime emits `bash_execution_update` events (pi ≥ 0.82.0) for direct RPC bash commands, the bridge SHALL subscribe to them and forward the incremental output chunks to subscribed browsers as a progressive-enhancement signal keyed to the executing command. The terminal `bash_output` event contract SHALL be preserved unchanged and SHALL remain the source of truth for the final rendered card; the client SHALL coalesce forwarded chunks into that same card rather than rendering a separate one.

Streaming SHALL be feature-detected by the availability of the `bash_execution_update` event, NOT by the pi version string. When the runtime does not emit `bash_execution_update` (older pi), the bridge SHALL forward only the terminal `bash_output` event and the client SHALL render exactly as it does today, with no error and no missing output.

#### Scenario: Chunks stream and coalesce into the terminal card

- **WHEN** the runtime emits `bash_execution_update` chunks followed by a terminal `bash_output`
- **THEN** the bridge SHALL forward each chunk to subscribed browsers
- **AND** the client SHALL coalesce the chunks into the single `bash_output` card whose final content matches the terminal event

#### Scenario: Runtime without streaming degrades to terminal-only

- **GIVEN** a pi runtime that does not emit `bash_execution_update`
- **WHEN** a bash command runs
- **THEN** only the terminal `bash_output` event SHALL be forwarded
- **AND** the client SHALL render the existing card with no error and no missing output

### Requirement: Bash session environment variables available to dashboard-side bash consumers

Where the dashboard runs bash on the pi side, BOTH consumers — factory bash tools AND worktreeInit-style hooks — MAY read the pi-provided session environment variables `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` (pi ≥ 0.82.0) for correlation. Each variable SHALL be treated as OPTIONAL: when it is absent (older pi), the consumer SHALL proceed without it and SHALL NOT fail or emit a degraded result solely because a variable is unset.

#### Scenario: Session env consumed when present

- **GIVEN** a pi runtime that exports `PI_SESSION_ID` to bash commands
- **WHEN** a dashboard-side bash consumer reads it
- **THEN** it MAY use the value for session correlation

#### Scenario: Missing session env does not break the consumer

- **GIVEN** a pi runtime that does not export the session env vars
- **WHEN** a dashboard-side bash consumer runs
- **THEN** it SHALL proceed with the variables treated as absent and SHALL NOT fail
