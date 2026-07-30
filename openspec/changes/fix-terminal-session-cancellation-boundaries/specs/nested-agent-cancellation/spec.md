## ADDED Requirements

### Requirement: Parent abort propagates to nested execution

`Agent`, `doubt`, and other supervised nested executions SHALL receive parent cancellation and SHALL request cooperative cancellation of their active child session before escalation.

#### Scenario: Parent stops active child inference

- **GIVEN** a nested child session is streaming a provider response
- **WHEN** the parent turn is aborted
- **THEN** the child session SHALL receive a cancellation request
- **AND** the parent tool SHALL settle when the child exits

#### Scenario: Parent stops child retry backoff

- **GIVEN** a nested child session is waiting on provider retry backoff
- **WHEN** the parent turn is aborted
- **THEN** the child retry wait SHALL be cancelled
- **AND** no further child provider request SHALL start

### Requirement: Independently stoppable nested agents use process isolation

Foreground `Agent` and `doubt` child execution SHALL run behind a separately identifiable process boundary. Terminating a non-cooperative child SHALL NOT terminate the parent pi process.

#### Scenario: Child tool ignores cancellation

- **GIVEN** a nested child tool remains pending after cooperative child abort
- **WHEN** the child cancellation grace expires
- **THEN** the supervisor SHALL terminate only the child process tree
- **AND** the parent tool SHALL settle as aborted
- **AND** the parent session SHALL remain able to continue

#### Scenario: Child blocks its event loop

- **GIVEN** a nested child blocks its own event loop
- **WHEN** the parent abort grace expires
- **THEN** the supervisor SHALL terminate the child process from outside that event loop
- **AND** the parent pi process SHALL remain alive

#### Scenario: Parent process is force-stopped

- **GIVEN** one or more isolated nested child processes are active
- **WHEN** the parent session receives verified Force Stop
- **THEN** the parent process-tree termination SHALL also terminate every nested child process

### Requirement: Nested execution settlement is singular and correlated

Each nested run SHALL have parent session ID, agent ID, and run ID correlation. It SHALL publish exactly one terminal settlement to the parent and SHALL ignore events received after that settlement.

#### Scenario: Child exits after cooperative abort

- **GIVEN** a child exits during the cooperative abort grace period
- **WHEN** its terminal event reaches the supervisor
- **THEN** the parent SHALL receive one aborted tool result
- **AND** no hard-kill escalation SHALL run

#### Scenario: Late child event follows hard termination

- **GIVEN** the supervisor already settled a child as aborted after hard termination
- **WHEN** a buffered child progress or completion event arrives
- **THEN** the event SHALL be discarded
- **AND** no second terminal settlement SHALL be published

#### Scenario: Concurrent nested runs

- **GIVEN** two nested runs are active for one parent session
- **WHEN** one run is aborted
- **THEN** only the matching run ID and child process SHALL be terminated
- **AND** the other nested run SHALL remain active

### Requirement: Nested cancellation remains observable

The system SHALL distinguish cooperative child cancellation, forced child termination, and parent Force Stop in structured events and logs without exposing child prompt or credential content.

#### Scenario: Cooperative child cancellation is recorded

- **WHEN** a nested child exits after cooperative abort
- **THEN** the terminal event SHALL identify the outcome as cooperative cancellation
- **AND** it SHALL include correlation IDs and elapsed time

#### Scenario: Forced child termination is recorded

- **WHEN** the supervisor terminates a non-cooperative child process
- **THEN** the terminal event SHALL identify forced child termination
- **AND** it SHALL include correlation IDs and elapsed time
