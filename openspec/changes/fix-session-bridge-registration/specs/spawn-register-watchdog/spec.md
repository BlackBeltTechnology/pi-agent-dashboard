## ADDED Requirements

### Requirement: Watchdog fire reports whether it terminated the spawn
On every fire the watchdog SHALL reclaim before writing the `REGISTER_TIMEOUT` log entry, dispatching the termination (the existing SIGTERM → 2 s → SIGKILL ladder) for each target pid under its own error handling. The `spawn_register_timeout` message and the log entry SHALL carry optional `terminated: true` and `terminatedPids` (only pids whose termination was dispatched without throwing) when at least one pid was signalled, and omit them otherwise. Which processes are reclaimed is unchanged.

#### Scenario: Fire that kills a process says so
- **WHEN** the watchdog fires for a headless spawn with pid `4242` and reclaim signals it
- **THEN** the `spawn_register_timeout` message and the `REGISTER_TIMEOUT` log entry SHALL include `terminated: true` and `terminatedPids: [4242]`

#### Scenario: Signalled means dispatched, not verified exit
- **WHEN** a reclaim kill is dispatched without throwing (the SIGTERM → 2 s → SIGKILL ladder runs fire-and-forget so the diagnostic is not delayed)
- **THEN** its pid SHALL count as signalled and the watchdog SHALL NOT claim verified process exit (an already-gone pid is indistinguishable from a signalled one)

#### Scenario: Fire with no reclaim target
- **WHEN** the watchdog fires and no pid is found to signal
- **THEN** neither the message nor the log entry SHALL include `terminated`

#### Scenario: Reclaim failure does not suppress the report
- **WHEN** a reclaim kill throws
- **THEN** the fire SHALL still log, persist and emit the timeout, without `terminated` for pids that were not signalled

#### Scenario: One failing kill does not abort the rest
- **WHEN** reclaim has two target pids and the kill of the first throws
- **THEN** the second pid SHALL still be signalled and `terminatedPids` SHALL contain only the second pid

#### Scenario: Log entry is written after reclaim
- **WHEN** the watchdog fires and reclaim signals a pid
- **THEN** the `REGISTER_TIMEOUT` log entry SHALL already carry `terminatedPids` for that pid (the entry is appended after reclaim, not before)
