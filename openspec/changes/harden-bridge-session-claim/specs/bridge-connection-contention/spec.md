## MODIFIED Requirements

### Requirement: A same-process reconnect is not a contention
When the registering socket reports the same pid the gateway has recorded for the
incumbent, it is the same pi process reconnecting after a lost or in-flight close
frame. The gateway SHALL replace the routing entry rather than refuse. The
reported pid SHALL be used only to avoid a refusal, never to justify one. The
same-pid rule SHALL apply only when the registering session's pid target is
`host`, or `unknown` on a Windows server (`force-kill-handler` *A recorded pid is
used only in its resolved pid target*), and only when the newcomer's origin equals
the session's recorded origin (*A claim is bound to the session's recorded origin*).
Otherwise the register SHALL be decided as a contention.

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

#### Scenario: A non-local same pid is not a same-process reconnect
- **WHEN** socket B registers for session `S` held by socket A with the same pid number
- **AND** B's pid target is not local
- **THEN** the register SHALL be decided as a contention, not as a same-process replace

#### Scenario: An incumbent in another namespace is not the same process
- **WHEN** socket B registers for session `S` with the same pid number as the incumbent's recorded pid
- **AND** B's pid target is `host` but the incumbent's recorded pid target is not `host`
- **THEN** the register SHALL be decided as a contention
- **AND** the same-pid replace SHALL apply only when both targets are `host`, or both are `unknown` on a Windows server

#### Scenario: A same pid from another origin is not a same-process reconnect
- **WHEN** socket B registers for session `S` held by a live socket A and reports the pid recorded for A
- **AND** B's origin differs from the recorded origin of `S`
- **THEN** B SHALL be refused as an origin mismatch
- **AND** the same-pid replace SHALL NOT apply

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
- **AND** the newcomer's origin equals the recorded origin of `S` (*A claim is bound to the session's recorded origin*)
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
- **AND** the socket's origin equals the recorded origin of `S2`, if `S2` has a completed record
- **THEN** the register SHALL be accepted
- **AND** the existing placeholder cleanup for the abandoned id SHALL apply
  unchanged

#### Scenario: An id change to another origin's session is refused without closing the socket
- **WHEN** a socket registered for session `S1` sends `session_register` for a different session `S2`
- **AND** `S2` has a completed record whose origin differs from the socket's
- **THEN** the register SHALL be refused as an origin mismatch and the socket SHALL NOT be closed
- **AND** the socket SHALL remain the routing entry for `S1`, with its record, heartbeat and placeholder cleanup unchanged
- **AND** the reply SHALL be a detail-free non-terminal frame, not `register_rejected`

### Requirement: Refusal is terminal for the losing bridge
The server SHALL send the losing bridge a rejection message identifying the
contention before closing its socket, and the bridge SHALL stop reconnecting for
that session id on receipt rather than retrying with backoff. The origin refusal
of an id change by a socket that still owns another session is exempt (*An origin
refusal is terminal and leaves the record untouched*): it is non-terminal and
leaves the socket open.

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
left open and unrouted, except a socket refused for origin on an id change while
it owns another session (it keeps that session), and a first frame dropped for
origin (closed only after repeated refusals; see the ADDED requirement). Server teardown SHALL terminate every socket the gateway
accepted, including sockets absent from the routing table.

#### Scenario: Refused newcomer does not linger
- **WHEN** socket B is refused for session `S`
- **THEN** socket B SHALL be closed
- **AND** socket B SHALL NOT appear in the routing table under any session id

#### Scenario: Teardown terminates an unrouted socket
- **WHEN** the gateway is stopped
- **AND** a socket exists that was accepted but is not in the routing table
- **THEN** that socket SHALL be terminated

### Requirement: Contention is observable
A refused register SHALL be logged distinctly from an accepted one and SHALL be
surfaced by the health endpoint, so the condition is diagnosable without reading
process tables. An origin refusal SHALL use its own line (see the scenario below),
not the contention line, and SHALL be counted with the contention refusals.

#### Scenario: Refusal is logged with both identities
- **WHEN** a `session_register` for session `S` is refused by contention
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

#### Scenario: An origin refusal has its own log line
- **WHEN** a claim for session `S` is refused as an origin mismatch, on a register, a first frame, a move commit or an id change
- **THEN** the server SHALL log `[bridge-claim] origin-refused session=<id> recorded=<class> presented=<class>`
- **AND** `<class>` SHALL be `hub`, `device:<8-char prefix>` or `unattributed`
- **AND** the line SHALL carry no pid, token or full device id, and SHALL be distinguishable from the contention line

## ADDED Requirements

### Requirement: A claim is bound to the session's recorded origin
The gateway SHALL refuse a socket claiming a session id whose recorded origin (`originDeviceId`, absent when hub-local) differs from the origin its credential admitted it with, never a register field. The rule SHALL run before the unheld, closed-incumbent and same-pid decisions, whatever the record's status. A placeholder (`source: "unknown"`, no `sessionFile`) is not bound; a `sessions_list`-seeded record is.

#### Scenario: Remote bridge cannot take a hub-local session
- **WHEN** session `S` is recorded as hub-local and its bridge is disconnected or live
- **AND** a socket admitted as paired device `D` sends `session_register` for `S`
- **THEN** the socket SHALL be refused and closed
- **AND** the routing entry, the recorded origin and the `sessionFile` of `S` SHALL be unchanged

#### Scenario: Another device cannot take a remote session
- **WHEN** session `S` is recorded with origin device `D1`
- **AND** a socket admitted as device `D2` sends `session_register` for `S`
- **THEN** the socket SHALL be refused as an origin mismatch

#### Scenario: A disconnected session is bound too
- **WHEN** the socket of session `S` is closed or absent (reconnect grace, or after a server restart that restored the record)
- **AND** a socket with a different origin sends `session_register` for `S`
- **THEN** the register SHALL be refused, not accepted as unheld or incumbent-closed

#### Scenario: The same origin reconnects
- **WHEN** the socket admitted as device `D` reconnects for a session recorded with origin `D`
- **THEN** the decision SHALL follow the existing probe and same-process rules

#### Scenario: A hub-local bridge reconnects
- **WHEN** a hub-local bridge re-registers for a session recorded as hub-local
- **THEN** the decision SHALL follow the existing probe and same-process rules

#### Scenario: Placeholder is not protected by origin
- **WHEN** the record for `S` is an auto-created placeholder that never completed a register
- **AND** a socket of any origin sends `session_register` for `S`
- **THEN** the register SHALL be accepted

#### Scenario: After the record is archived the id is unheld
- **WHEN** the record of session `S`, bound to origin `A`, is archived (removed from the session manager)
- **AND** a socket of another origin `B` sends `session_register` for `S`
- **THEN** the claim SHALL be decided as unheld and accepted, and the new record SHALL carry origin `B`

#### Scenario: Unattributed remotes are one class
- **WHEN** session `S` is recorded with the unattributed-remote origin and another unattributed remote registers it
- **THEN** the origin check SHALL pass
- **AND** a device-attributed or hub-local socket SHALL still be refused

### Requirement: An origin refusal is terminal and leaves the record untouched
A `session_register` claim refused for an origin mismatch SHALL be terminal as a contention refusal is (the socket is closed), except when the socket still owns another session and is changing its id. A refused session-move commit SHALL get the existing detail-free refusal. A refusal SHALL NOT rewrite the recorded origin or any other field of the record, SHALL be logged and counted, and SHALL NOT name the recorded origin to the bridge.

#### Scenario: Refusal does not touch the record
- **WHEN** a `session_register` claim is refused as an origin mismatch
- **THEN** the routing entry, the recorded origin, the `sessionFile` and the spawn watchdog SHALL be unchanged
- **AND** the refused bridge SHALL be told the reason and SHALL stop retrying for that session id

#### Scenario: Refusal is observable
- **WHEN** a claim is refused as an origin mismatch
- **THEN** the server log SHALL use the `[bridge-claim] origin-refused` line defined in *Contention is observable*, naming the session id and both origins by class
- **AND** it SHALL be rate-limited per session id like a contention refusal
- **AND** `/api/health` SHALL count it with the contention refusals

### Requirement: Every routing-taking path obeys the origin binding
The origin binding SHALL apply to the register claim, to a first frame that names a session id without registering, and to the session-move commit. A first frame or commit from a socket whose origin differs from the recorded origin SHALL NOT take the entry and SHALL be dropped with every no-side-effect guarantee of *A refused register has no side effects*. A placeholder created for a first frame SHALL record that socket's origin.

#### Scenario: First frame naming another origin's session is dropped
- **WHEN** a socket with no registered session sends a non-register frame naming session `S`
- **AND** `S` has a completed record with a different origin and no live incumbent
- **THEN** the socket SHALL NOT become the routing entry for `S` and SHALL NOT be recorded as owning it
- **AND** the frame SHALL NOT reach the event pipeline
- **AND** no heartbeat reset, spawn-watchdog clear, placeholder or ghost cleanup, or event SHALL result

#### Scenario: An origin-refused first frame leaves the socket open
- **WHEN** a socket's first frame is refused for origin
- **THEN** the frame SHALL be dropped and the socket SHALL stay open but unrouted, as for a first frame naming a live-held id

#### Scenario: Repeated origin-refused first frames close the socket
- **WHEN** one socket sends first frames naming sessions with a different origin and 3 are refused for origin
- **THEN** the socket SHALL be closed
- **AND** the first two refusals SHALL have left it open and unrouted

#### Scenario: Move commit cannot cross origins
- **WHEN** a socket holding a valid move token for session `S` commits
- **AND** `S` has a completed record with a different origin
- **THEN** the commit SHALL NOT take the routing entry
- **AND** the incumbent's record, heartbeat and timers, the spawn watchdog and the event pipeline SHALL be unchanged and no event SHALL be emitted
- **AND** the reply SHALL be the existing detail-free refusal

#### Scenario: Every origin-refusal path is logged and counted
- **WHEN** an origin refusal occurs on a first frame, a move commit or an id change
- **THEN** the `[bridge-claim] origin-refused` line SHALL be logged and the refusal counted in `/api/health`, as for a register
- **AND** an id-change refusal SHALL have no per-socket cap and SHALL NOT close the socket

#### Scenario: Placeholder carries the creating socket's origin
- **WHEN** a remote socket's first frame names an unknown session id
- **THEN** the placeholder record SHALL carry that socket's origin, not read as hub-local

### Requirement: A history record seeded from a sessions list is bound to the reporter's origin
A `sessions_list` report SHALL seed a record for an unseen session id with the reporting socket's origin (never hub-local by default). It SHALL rewrite `sessionFile`/`sessionDir` of an existing record only when the reporting socket's origin equals the record's recorded origin. The reporting socket's origin is derived from its credential.

#### Scenario: A history record seeded by sessions_list is bound to the reporter's origin
- **WHEN** a socket admitted as device `D` reports an unseen session id in `sessions_list`
- **THEN** the seeded record SHALL carry origin `D`
- **AND** a later `session_register` for that id from a hub-local or other-device socket SHALL be refused as an origin mismatch

#### Scenario: sessions_list from another origin does not rewrite sessionFile
- **WHEN** session `S` is recorded with origin `D1` (or hub-local)
- **AND** a socket with a different origin reports `S` in `sessions_list` with another path
- **THEN** the `sessionFile` and `sessionDir` of `S` SHALL be unchanged
