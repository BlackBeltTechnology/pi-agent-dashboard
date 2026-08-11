## ADDED Requirements

### Requirement: One live bridge connection per session id
The pi-gateway SHALL hold at most one live WebSocket connection per `sessionId`
in its routing table. A `session_register` naming a `sessionId` whose routing
entry currently holds a **different** socket in the `OPEN` state SHALL be
treated as a contention and resolved in favour of the incumbent: the newcomer
SHALL be refused and its socket closed, and the incumbent's routing entry SHALL
be left untouched.

#### Scenario: Second live socket claims a held session id
- **WHEN** socket A is registered for session `S` and is `OPEN`
- **AND** socket B sends `session_register` for the same session `S`
- **THEN** the routing entry for `S` SHALL still resolve to socket A
- **AND** socket B SHALL be closed by the server
- **AND** a subsequent `sendToSession(S, …)` SHALL be delivered to socket A

#### Scenario: Prompt reaches the incumbent, not the newcomer
- **WHEN** socket B has been refused for session `S`
- **AND** a prompt is sent to session `S`
- **THEN** socket A SHALL receive the prompt message
- **AND** socket B SHALL NOT receive it

#### Scenario: Re-register on a closed incumbent is not a contention
- **WHEN** the socket registered for session `S` is `CLOSED`
- **AND** another socket sends `session_register` for session `S`
- **THEN** the newcomer SHALL be accepted and SHALL become the routing entry
  for `S`
- **AND** it SHALL NOT be refused or closed

#### Scenario: The same socket re-registering is not a contention
- **WHEN** the socket already registered for session `S` sends
  `session_register` for `S` again
- **THEN** the register SHALL be accepted and the socket SHALL remain the
  routing entry for `S`

#### Scenario: A socket changing its session id is not a contention
- **WHEN** a socket registered for session `S1` sends `session_register` for a
  different session `S2` that no live socket holds
- **THEN** the register SHALL be accepted
- **AND** the existing placeholder cleanup for the abandoned id SHALL apply
  unchanged

### Requirement: A half-open incumbent is cleared by reaping, not by tie-breaking
The contention rule SHALL evaluate the incumbent's socket state only. Recovery
from an incumbent whose peer is gone SHALL be delegated to the existing ping and
heartbeat reapers; once the reaper terminates the dead incumbent and its routing
entry is cleared, a subsequent register from the reconnecting bridge SHALL be
accepted.

#### Scenario: TCP-dead incumbent is reaped and the reconnect then succeeds
- **WHEN** the incumbent socket for session `S` is terminated by the ping reaper
  as TCP-dead
- **THEN** the routing entry for `S` SHALL be cleared
- **AND** a following `session_register` for `S` from another socket SHALL be
  accepted

#### Scenario: Register path does not score liveness itself
- **WHEN** a `session_register` contends with an incumbent that is `OPEN`
- **THEN** the refusal SHALL NOT depend on heartbeat age, ping-miss count, or
  any field self-reported on the register message

### Requirement: A losing socket is closed, never leaked
Any socket that loses a contention SHALL be closed by the server rather than
left open and unrouted. Server teardown SHALL terminate every socket the gateway
accepted, including sockets absent from the routing table.

#### Scenario: Refused newcomer does not linger
- **WHEN** socket B is refused for session `S`
- **THEN** socket B SHALL be closed
- **AND** socket B SHALL NOT appear in the routing table under any session id

#### Scenario: Teardown terminates an unrouted socket
- **WHEN** the gateway is stopped
- **AND** a socket exists that was accepted but is not in the routing table
- **THEN** that socket SHALL be terminated

### Requirement: Connection cleanup is scoped to socket identity
A socket closing SHALL only remove a routing entry that still points at that
same socket. A socket that no longer owns its former entry SHALL NOT evict the
socket that does.

#### Scenario: Closing displaced socket does not evict the live owner
- **WHEN** socket A owns the routing entry for session `S`
- **AND** a different socket that previously referenced `S` closes
- **THEN** the routing entry for `S` SHALL still resolve to socket A

#### Scenario: Closing owner clears its own entry
- **WHEN** the socket that owns the routing entry for session `S` closes
- **THEN** cleanup for `S` SHALL proceed as it does today for that session kind

### Requirement: Contention is observable
A refused register SHALL be logged distinctly from an accepted one and SHALL be
surfaced by the health endpoint, so the condition is diagnosable without reading
process tables.

#### Scenario: Refusal is logged with both identities
- **WHEN** a `session_register` for session `S` is refused
- **THEN** the server SHALL log a line identifying the contention, the session
  id, the incumbent pid, and the refused newcomer pid
- **AND** that line SHALL be distinguishable from
  `[gateway] session registered: <sessionId> cwd=<cwd>`

#### Scenario: Health exposes contention
- **WHEN** at least one register has been refused
- **THEN** `/api/health` SHALL report the contention, including the affected
  session id(s)
