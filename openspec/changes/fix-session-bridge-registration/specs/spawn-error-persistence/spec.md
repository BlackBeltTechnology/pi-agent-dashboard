## ADDED Requirements

### Requirement: Timeout banner states termination
When a `spawn_register_timeout` message carries `terminated: true`, the timeout banner label SHALL state that the dashboard terminated the pi process, in addition to the existing never-connected text. Without the field the label is unchanged.

#### Scenario: Terminated spawn labelled
- **WHEN** a `spawn_register_timeout` with `pid: 123`, `timeoutMs: 30000` and `terminated: true` arrives
- **THEN** the banner SHALL read "Pi started (PID 123) but never connected to the dashboard within 30s and was terminated."

#### Scenario: Legacy server message unchanged
- **WHEN** a `spawn_register_timeout` arrives without `terminated`
- **THEN** the banner label SHALL be the existing never-connected text
