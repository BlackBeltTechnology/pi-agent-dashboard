# bridge-connection-contention Specification

## Purpose

Guarantees that exactly one live bridge WebSocket serves a given `sessionId`, so
server→extension messages — prompts included — cannot be delivered to a socket
that lost a silent last-writer-wins race. Covers the claim point, the two-factor
liveness probe that resolves contention, the terminal refusal protocol, and the
identity-scoped cleanup and teardown that keep a displaced socket from
corrupting a live session's state.

## Requirements
### Requirement: One live bridge connection per session id
The pi-gateway SHALL hold at most one live WebSocket connection per `sessionId`
in its routing table. The rule SHALL be enforced at the point a socket claims a
routing entry — the first message carrying a `sessionId`, which includes
`session_register` itself — and not only in the `session_register` branch.

#### Scenario: Second live socket claims a held session id
- **WHEN** socket A is registered for session `S` and answers a liveness probe
- **AND** socket B sends `session_register` for the same session `S`
- **THEN** the routing entry for `S` SHALL still resolve to socket A
- **AND** socket B SHALL be refused and closed
- **AND** a subsequent `sendToSession(S, …)` SHALL be delivered to socket A

#### Scenario: Prompt reaches the incumbent, not the newcomer
- **WHEN** socket B has been refused for session `S`
- **AND** a prompt is sent to session `S`
- **THEN** socket A SHALL receive the prompt message
- **AND** socket B SHALL NOT receive it

#### Scenario: A non-register first message cannot claim a held id
- **WHEN** socket A owns the routing entry for session `S` and is live
- **AND** socket B's first message is any other message type carrying
  `sessionId: S`
- **THEN** socket B SHALL NOT become the routing entry for `S`

#### Scenario: Re-register on a closed incumbent is not a contention
- **WHEN** the socket registered for session `S` is `CLOSED`
- **AND** another socket sends `session_register` for session `S`
- **THEN** the newcomer SHALL be accepted and SHALL become the routing entry
  for `S`
- **AND** it SHALL NOT be refused, closed, or probed

#### Scenario: The same socket re-registering is not a contention
- **WHEN** the socket already registered for session `S` sends
  `session_register` for `S` again
- **THEN** the register SHALL be accepted and the socket SHALL remain the
  routing entry for `S`
- **AND** no liveness probe SHALL be issued

#### Scenario: A socket changing its session id is not a contention
- **WHEN** a socket registered for session `S1` sends `session_register` for a
  different session `S2` that no live socket holds
- **THEN** the register SHALL be accepted
- **AND** the existing placeholder cleanup for the abandoned id SHALL apply
  unchanged

### Requirement: Contention is resolved by a bounded two-factor probe
On contention the gateway SHALL probe the incumbent socket and wait a bounded
window. The incumbent SHALL keep the routing entry when it answers the probe, or
when it does not answer but its underlying TCP socket is still writable — the
same rule the ping reaper already applies, because a bridge busy executing a tool
cannot process pong frames. Only an incumbent that neither answers nor has a
writable socket SHALL be terminated and displaced. The decision SHALL NOT depend
on heartbeat age, ping-miss count, or any field self-reported on the register
message, except as allowed by the same-process reconnect rule below.

#### Scenario: Live incumbent answers the probe and keeps the session
- **WHEN** socket B contends for session `S` held by socket A
- **AND** socket A answers the probe within the window
- **THEN** socket A SHALL remain the routing entry for `S`
- **AND** socket B SHALL be refused

#### Scenario: Busy incumbent that cannot pong is not displaced
- **WHEN** socket B contends for session `S` held by socket A
- **AND** socket A does not answer the probe within the window
- **AND** socket A's underlying TCP socket is still writable
- **THEN** socket A SHALL remain the routing entry for `S`
- **AND** socket A SHALL NOT be terminated
- **AND** socket B SHALL be refused

#### Scenario: Dead incumbent is displaced by the newcomer
- **WHEN** socket B contends for session `S` held by socket A
- **AND** socket A does not answer the probe within the window
- **AND** socket A's underlying TCP socket is not writable
- **THEN** socket A SHALL be terminated and its routing entry cleared
- **AND** socket B SHALL be accepted as the routing entry for `S`

#### Scenario: Refusal does not read self-reported register fields
- **WHEN** a `session_register` contends with an incumbent
- **THEN** the refusal SHALL be determined by the probe outcome only
- **AND** SHALL NOT depend on `isNew`, `registerReason`, or any other
  self-reported field on the register message

### Requirement: A same-process reconnect is not a contention
When the registering socket reports the same pid the gateway has recorded for the
incumbent, it is the same pi process reconnecting after a lost or in-flight close
frame. The gateway SHALL replace the routing entry rather than refuse. The
reported pid SHALL be used only to avoid a refusal, never to justify one.

#### Scenario: Same pid replaces rather than is refused
- **WHEN** socket B registers for session `S` held by socket A
- **AND** B reports the same pid recorded for the incumbent
- **THEN** socket B SHALL become the routing entry for `S`
- **AND** socket B SHALL NOT be refused or closed

#### Scenario: A differing pid grants no advantage
- **WHEN** socket B registers for session `S` held by a live socket A
- **AND** B reports a pid different from the incumbent's
- **THEN** the contention SHALL be resolved by the probe rule alone

#### Scenario: A placeholder incumbent is never protected
- **WHEN** the routing entry for `S` is held by an auto-created placeholder that
  has never completed a `session_register`
- **AND** a socket sends `session_register` for `S`
- **THEN** the register SHALL be accepted and SHALL become the routing entry
- **AND** it SHALL NOT be refused on contention grounds

### Requirement: A refused register has no side effects
A register that loses a contention SHALL NOT mutate any state belonging to the
incumbent. In particular it SHALL NOT clear the spawn-register watchdog, SHALL
NOT run placeholder or ghost-session cleanup, and SHALL NOT be forwarded to the
event pipeline where it would strip the incumbent's `sessionFile` or consume a
spawn-correlation token.

#### Scenario: Refused register leaves the incumbent's session file intact
- **WHEN** a register carrying `sessionFile` `F` is refused for session `S`
- **THEN** the incumbent session's `sessionFile` SHALL still be `F`

#### Scenario: Refused register leaves the spawn watchdog armed
- **WHEN** a register carrying a spawn token is refused
- **THEN** the spawn-register watchdog for that token SHALL remain armed

#### Scenario: An id-change register is decided before any side effect
- **WHEN** a socket already registered for `S1` sends `session_register` for `S2`
  that a different live socket holds
- **THEN** the contention SHALL be decided before the spawn-watchdog clear runs
- **AND** no pending spawn watchdog SHALL be disarmed by the refused register

#### Scenario: Refused register is not forwarded to the event pipeline
- **WHEN** a register is refused
- **THEN** no session-registered event SHALL be emitted for it

#### Scenario: Refused register does not reset the incumbent's heartbeat
- **WHEN** a register for session `S` is refused
- **THEN** the incumbent's heartbeat and reconnect-grace timers SHALL be
  unchanged

#### Scenario: A non-owning socket cannot mutate session state
- **WHEN** a socket that does not own the routing entry for `S` sends a
  heartbeat or model update naming `S`
- **THEN** the message SHALL be dropped
- **AND** the incumbent's heartbeat timer and process metrics SHALL be unchanged

### Requirement: Refusal is terminal for the losing bridge
The server SHALL send the losing bridge a rejection message identifying the
contention before closing its socket, and the bridge SHALL stop reconnecting for
that session id on receipt rather than retrying with backoff.

#### Scenario: Refused bridge is told why
- **WHEN** a register for session `S` is refused
- **THEN** the server SHALL send a rejection message naming `S` and the reason
- **AND** SHALL then close that socket

#### Scenario: Refused bridge stops retrying
- **WHEN** a bridge receives a contention rejection for session `S`
- **THEN** it SHALL NOT reconnect and re-register for `S`
- **AND** it SHALL surface the reason rather than failing silently

#### Scenario: A bridge that ignores the rejection is still refused
- **WHEN** a bridge re-registers for `S` after a rejection
- **THEN** the register SHALL be refused again by the same rule
- **AND** the refusal log line and health entry SHALL be rate-limited per
  session id rather than emitted once per attempt

#### Scenario: The refused spawn is reclaimed rather than left writing
- **WHEN** a register is refused for a session the server itself spawned
- **THEN** the spawn-register watchdog SHALL remain armed for that spawn
- **AND** the spawn SHALL be reclaimed by its server-minted spawn token
- **AND** this SHALL hold for every spawn entry point — REST resume, WebSocket
  resume, zombie reopen, and headless reload — not only the WebSocket spawn path

#### Scenario: Reclaim does not require a browser transport
- **WHEN** a spawn armed from a caller with no browser WebSocket fails to
  register
- **THEN** the spawn SHALL still be reclaimed by its server-minted token

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
Every id-keyed cleanup triggered by a closing socket SHALL first confirm the
routing entry still points at that same socket. This covers the routing-table
removal, the disconnect callback, session unregistration, and automation-run
finalization. A socket that no longer owns its former entry SHALL NOT evict,
disconnect, unregister, or finalize the session that another socket serves.

#### Scenario: Closing displaced socket does not evict the live owner
- **WHEN** socket A owns the routing entry for session `S`
- **AND** a different socket that previously referenced `S` closes
- **THEN** the routing entry for `S` SHALL still resolve to socket A

#### Scenario: Closing displaced socket raises no disconnect for the live session
- **WHEN** socket A owns the routing entry for session `S`
- **AND** a different socket that previously referenced `S` closes
- **THEN** no disconnect SHALL be signalled for `S`

#### Scenario: Closing displaced socket does not finalize a live automation run
- **WHEN** an automation session `S` is served by socket A
- **AND** a different socket that previously referenced `S` closes
- **THEN** session `S` SHALL NOT be unregistered or finalized

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

#### Scenario: An unknown pid does not suppress the log line
- **WHEN** a refusal occurs and either the incumbent or the newcomer has no
  recorded pid
- **THEN** the contention line SHALL still be logged, rendering the missing pid
  as an explicit unknown placeholder

#### Scenario: Health exposes contention
- **WHEN** at least one register has been refused
- **THEN** `/api/health` SHALL report a cumulative refusal count and the
  currently recorded contended session id(s)

#### Scenario: A contended id is cleared from health
- **WHEN** a session with a recorded contention disconnects cleanly or ends
- **THEN** its id SHALL no longer be listed as contended
- **AND** the cumulative count SHALL be unchanged

