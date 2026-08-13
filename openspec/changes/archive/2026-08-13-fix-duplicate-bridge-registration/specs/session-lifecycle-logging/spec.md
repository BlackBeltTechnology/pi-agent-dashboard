## ADDED Requirements

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
