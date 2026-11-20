## ADDED Requirements

### Requirement: Watchdog fire reports whether it terminated the spawn
On every fire, the watchdog SHALL record which pids its reclaim signalled. The `spawn_register_timeout` browser message SHALL carry optional `terminated: true` and `terminatedPids` when at least one pid was signalled, and the `REGISTER_TIMEOUT` failure-log entry SHALL carry the same fields. A fire whose reclaim found no target SHALL omit them. Reclaim behaviour is unchanged.

#### Scenario: Fire that kills a process says so
- **WHEN** the watchdog fires for a headless spawn with pid `4242` and reclaim signals it
- **THEN** the `spawn_register_timeout` message and the `REGISTER_TIMEOUT` log entry SHALL include `terminated: true` and `terminatedPids: [4242]`

#### Scenario: Fire with no reclaim target
- **WHEN** the watchdog fires and no pid is found to signal
- **THEN** neither the message nor the log entry SHALL include `terminated`

#### Scenario: Reclaim failure does not suppress the report
- **WHEN** a reclaim kill throws
- **THEN** the fire SHALL still log, persist and emit the timeout, without `terminated` for pids that were not signalled
