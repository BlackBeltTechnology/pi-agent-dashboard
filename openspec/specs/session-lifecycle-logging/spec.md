## Purpose

Defines the server-side log lines that make pi session lifecycle transitions — registration, unregistration and WebSocket close — visible and attributable in `server.log`.
## Requirements
### Requirement: Log session registration
The pi-gateway SHALL log when a session is registered via `session_register` message.

#### Scenario: Session registers successfully
- **WHEN** the server processes a `session_register` message
- **THEN** it SHALL log `[gateway] session registered: <sessionId> cwd=<cwd>` to stderr

### Requirement: Log session unregistration with reason
The pi-gateway SHALL log when a session is unregistered, including the reason for unregistration.

#### Scenario: Explicit unregister from bridge
- **WHEN** the server processes a `session_unregister` message
- **THEN** it SHALL log `[gateway] session unregistered: <sessionId> (explicit)` to stderr

#### Scenario: Heartbeat timeout
- **WHEN** the heartbeat timer fires and the session is unregistered
- **THEN** it SHALL log `[gateway] session timed out: <sessionId> (no heartbeat for 45s)` to stderr

#### Scenario: Sleep recovery failure
- **WHEN** the sleep-retry heartbeat timer fires and the session is unregistered
- **THEN** it SHALL log `[gateway] session timed out: <sessionId> (sleep recovery failed)` to stderr

#### Scenario: Ping timeout
- **WHEN** a connection is terminated due to WS ping timeout
- **THEN** it SHALL log `[gateway] connection dead (ping timeout): <sessionId>` to stderr

### Requirement: Log WebSocket connection close
The pi-gateway SHALL log when a bridge WebSocket connection closes.

#### Scenario: Connection closes
- **WHEN** a bridge WebSocket connection fires the `close` event
- **THEN** it SHALL log `[gateway] connection closed: <sessionId>` to stderr

### Requirement: Log refused duplicate registration
The pi-gateway SHALL log a refused `session_register` distinctly from an
accepted one. The line SHALL name the session id, the incumbent pid, and the
refused newcomer pid, so a duplicate is identifiable from `server.log` alone.

#### Scenario: Duplicate register refused
- **WHEN** a `session_register` for a session id held by a different `OPEN`
  socket is refused
- **THEN** the server SHALL log a contention line to stderr carrying the session
  id, the incumbent pid, and the newcomer pid

#### Scenario: Missing pid renders as unknown
- **WHEN** a refusal is logged and the incumbent or newcomer has no recorded pid
- **THEN** the contention line SHALL still be emitted with an explicit unknown
  placeholder in place of the missing pid

#### Scenario: Refusal is not logged as a registration
- **WHEN** a `session_register` is refused
- **THEN** the server SHALL NOT log
  `[gateway] session registered: <sessionId> cwd=<cwd>` for that message

#### Scenario: Ordinary re-register stays quiet
- **WHEN** a `session_register` is accepted because no different `OPEN` socket
  holds the id (reconnect, `/reload`, or in-process id change)
- **THEN** the server SHALL log the existing registration line
- **AND** SHALL NOT log a contention line

