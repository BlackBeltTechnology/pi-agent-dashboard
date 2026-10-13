## MODIFIED Requirements

### Requirement: Server Liveness Detection with Stale Cleanup

The system SHALL determine whether the dashboard server is running by combining the recorded PID with a process-liveness check and a dashboard health check on the given port. The health check SHALL use a bounded retry budget. The system SHALL remove the PID file only when the recorded process is not alive. A live process whose health check does not report running SHALL leave the PID file in place.

#### Scenario: Server confirmed running

- **WHEN** `isServerRunning` is called and the recorded PID belongs to a live process
- **AND** the dashboard health check on the given port reports running
- **THEN** the recorded PID is returned

#### Scenario: No recorded PID

- **WHEN** `isServerRunning` is called and `readPid` returns null
- **THEN** null is returned

#### Scenario: Live process but dashboard not responding (recycled PID)

- **WHEN** `isServerRunning` is called and the recorded PID belongs to a live process
- **AND** the dashboard health check on the given port does not report running within the retry budget
- **THEN** null is returned
- **AND** the PID file SHALL NOT be removed or modified

#### Scenario: Dead process PID

- **WHEN** `isServerRunning` is called and the recorded PID does not belong to a live process
- **THEN** the PID file is removed as stale
- **AND** null is returned
