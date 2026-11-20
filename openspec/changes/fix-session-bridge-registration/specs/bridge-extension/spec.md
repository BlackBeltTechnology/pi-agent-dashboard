## ADDED Requirements

### Requirement: Bridge ownership is released on session-replacing shutdown
When the bridge instance that owns the process-wide bridge slot receives `session_shutdown` with `reason` `reload`, `new`, `resume` or `fork`, it SHALL release ownership so the fresh extension instance pi loads next initialises the bridge. A different pi instance that loads while the owner has not shut down (a subagent) SHALL still be skipped. `quit` SHALL NOT release ownership.

#### Scenario: Resume replacement registers
- **WHEN** the owning instance receives `session_shutdown{reason:"resume"}` and pi then loads a new extension instance
- **THEN** the new instance SHALL pass the re-entry guard and send `session_register` for the incoming session

#### Scenario: New and fork replacement register
- **WHEN** the owning instance receives `session_shutdown{reason:"new"}` or `{reason:"fork"}` and pi loads a new instance
- **THEN** the new instance SHALL pass the re-entry guard

#### Scenario: Subagent load is still rejected
- **WHEN** a different pi instance loads while the owner has received no `session_shutdown`
- **THEN** initialisation SHALL be skipped and the parent's bridge SHALL be unchanged

#### Scenario: Quit does not release
- **WHEN** the owner receives `session_shutdown{reason:"quit"}` and a different pi instance loads
- **THEN** the re-entry guard SHALL still reject it
