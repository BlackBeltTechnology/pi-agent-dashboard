## ADDED Requirements

### Requirement: Back-pressure loss forces browser resynchronization
When an open browser socket exceeds the configured send-buffer ceiling, the gateway SHALL record the dropped frame and terminate that socket instead of continuing a silently stale connection. The client SHALL reconnect through its existing bounded backoff path.

#### Scenario: Ordinary high-volume frame crosses the ceiling
- **WHEN** an ordinary server-to-browser frame is ready to send and the target socket's buffered amount already exceeds the ceiling
- **THEN** the frame SHALL be counted as dropped
- **AND** the affected socket SHALL be terminated exactly once so reconnect and replay can begin
- **AND** other healthy sockets SHALL remain connected

#### Scenario: Healthy socket remains unchanged
- **WHEN** a target socket is open and below the configured ceiling
- **THEN** the frame SHALL be sent without terminating the socket

### Requirement: Reconnect discards only unconfirmed interactive control state
On a browser reconnect, the client SHALL remove pending interactive requests and their matching pending transcript rows before authoritative pending-request replay. Resolved, cancelled, dismissed, and notification transcript rows SHALL remain.

#### Scenario: Lost prompt request recovers
- **WHEN** `prompt_request` was dropped before the gateway terminated the connection
- **AND** the prompt remains pending on the server
- **THEN** reconnect subscription replay SHALL add the pending request to the client without a page refresh

#### Scenario: Lost prompt cancel or dismiss recovers
- **WHEN** the client still shows a pending request but its `prompt_cancel` or `prompt_dismiss` was dropped
- **AND** the server no longer tracks that request
- **THEN** reconnect SHALL remove the stale pending request
- **AND** replay SHALL not recreate it
