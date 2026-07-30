## ADDED Requirements

### Requirement: Stop cancels every active turn wait

The session cancellation boundary SHALL cancel the active provider request, provider retry backoff, and cooperative tool execution for the current turn. Cancellation SHALL NOT require another provider request or agent step to begin.

#### Scenario: Stop during provider retry backoff

- **GIVEN** a terminal session is waiting on provider auto-retry backoff
- **WHEN** the dashboard sends `abort`
- **THEN** the retry wait SHALL end without starting another provider request
- **AND** the session SHALL transition out of retrying state

#### Scenario: Stop during active provider stream

- **GIVEN** a provider stream is active for the current turn
- **WHEN** the dashboard sends `abort`
- **THEN** the provider request SHALL receive an aborted signal
- **AND** no additional assistant content SHALL be committed after abort settlement

#### Scenario: Stop during cooperative tool execution

- **GIVEN** the current tool observes its supplied `AbortSignal`
- **WHEN** the dashboard sends `abort`
- **THEN** the tool SHALL receive the aborted signal
- **AND** the current turn SHALL settle without starting another agent step

### Requirement: Non-cooperative tool wait is bounded

After explicit turn abort, the agent execution boundary SHALL stop awaiting a tool that remains pending beyond the configured cleanup grace period. The system SHALL record one aborted tool settlement and SHALL ignore late progress or completion from that execution.

#### Scenario: Tool ignores AbortSignal

- **GIVEN** a tool Promise remains pending after its signal is aborted
- **WHEN** the cleanup grace period expires
- **THEN** the parent turn SHALL settle as aborted
- **AND** the session SHALL remain able to accept a later prompt

#### Scenario: Detached tool rejects late

- **GIVEN** the parent turn already settled after the tool abort grace expired
- **WHEN** the original tool Promise later rejects
- **THEN** the rejection SHALL be handled without an unhandled-rejection event
- **AND** the settled turn SHALL NOT be modified

#### Scenario: Detached tool reports progress late

- **GIVEN** the parent turn already settled after the tool abort grace expired
- **WHEN** the original tool emits a progress update or result
- **THEN** the update SHALL be discarded
- **AND** it SHALL NOT appear in a newer turn

### Requirement: Bridge registers owning process PID

Every bridge `session_register` message SHALL include the current pi process PID. The server SHALL refresh the owning session PID on initial registration and reconnect.

#### Scenario: Terminal session registers

- **GIVEN** pi starts from an ordinary terminal without a dashboard session marker in its command line
- **WHEN** the bridge registers the session
- **THEN** the registration SHALL contain `pid: process.pid`
- **AND** the server session SHALL retain that PID as the Force Stop target

#### Scenario: Bridge reconnect refreshes PID

- **GIVEN** a session reconnects from a new pi process after resume or respawn
- **WHEN** the bridge sends a new registration
- **THEN** the server SHALL replace the previous PID with the newly registered PID

### Requirement: Force Stop resolves and verifies the process target

Force Stop SHALL resolve a registered or safely discovered pi PID before closing its bridge connection. It SHALL terminate the complete target process tree, verify that the owning PID exited, and report explicit success or failure.

#### Scenario: Registered terminal PID is terminated

- **GIVEN** a terminal-origin session has a registered live pi PID
- **WHEN** the user invokes Force Stop
- **THEN** the server SHALL terminate the pi process and its descendant process groups
- **AND** it SHALL mark the session ended only after verified PID exit

#### Scenario: PID cannot be resolved safely

- **GIVEN** a session has no registered PID and no safe dashboard marker match
- **WHEN** the user invokes Force Stop
- **THEN** the server SHALL return `force_kill_result { success: false }`
- **AND** it SHALL NOT mark the session ended
- **AND** it SHALL NOT close a still-usable bridge merely because lookup failed

#### Scenario: Registered PID was reused

- **GIVEN** the registered PID is alive but no longer identifies a pi process
- **WHEN** the user invokes Force Stop
- **THEN** the server SHALL refuse to signal that PID
- **AND** it SHALL return an explicit PID-reuse failure

#### Scenario: Target survives termination

- **GIVEN** the target PID remains alive after process-tree termination and verification timeout
- **WHEN** Force Stop completes
- **THEN** the server SHALL return `force_kill_result { success: false }`
- **AND** the session status SHALL remain unchanged

### Requirement: Explicit abort watchdog cleans tracked child groups

The bridge SHALL arm its child-process watchdog only after an explicit user abort. It SHALL disarm when the turn settles and SHALL target only process groups captured for that session.

#### Scenario: Child group survives cooperative abort

- **GIVEN** explicit Stop was acknowledged and a captured child process group remains alive
- **WHEN** the watchdog delay expires
- **THEN** the bridge SHALL send SIGTERM to that process group
- **AND** it SHALL escalate surviving group members to SIGKILL after the kill grace period

#### Scenario: Turn settles before watchdog delay

- **GIVEN** the watchdog is armed after explicit Stop
- **WHEN** the turn settles before the watchdog delay expires
- **THEN** the watchdog SHALL disarm
- **AND** it SHALL send no process signal

#### Scenario: Provider error without user Stop

- **GIVEN** a provider request fails without an explicit user abort
- **WHEN** the session reports the error
- **THEN** the child-process watchdog SHALL remain disarmed
