## ADDED Requirements

### Requirement: Session id maps to exactly one live bridge
A dashboard session id SHALL identify exactly one live bridge connection at a
time. The gateway SHALL enforce this rather than assume it: routing a
server→extension message for a session SHALL never be satisfied by a socket that
displaced another live socket for the same id.

#### Scenario: Routing resolves to the enforced owner
- **WHEN** two sockets have claimed one session id and the contention has been
  resolved
- **THEN** exactly one socket SHALL be routable for that session id
- **AND** the other SHALL be closed

#### Scenario: A session file may back only one live session id
- **WHEN** a bridge is live for a session whose `sessionFile` is `F`
- **THEN** the server SHALL NOT create a second live session backed by `F`
  through the resume path

### Requirement: Bridge delivery is not inferred from socket openness alone
Reporting a server→extension send as successful SHALL mean the message was
written to the socket the gateway holds as the owner of that session id. A
send SHALL NOT be reported successful on the basis that some socket for that id
is `OPEN` when the session's bridge is in a contended state, and a contended
session SHALL be distinguishable from a healthy one by API callers.

Contention is a recorded episode, not a live routing state: a refusal stamps a
contention record on the affected session id. The record SHALL be cleared by
whichever occurs first — the refused spawn being reclaimed, a bounded expiry, the
incumbent disconnecting, or the session ending — so that a healthy incumbent that
never disconnects cannot pin the record for the session's remaining life.

#### Scenario: Prompt API does not claim success for a contended bridge
- **WHEN** a prompt is submitted for a session that has a live contention record
- **THEN** the API SHALL NOT return a plain success result
- **AND** the response SHALL identify the bridge state as the reason
- **AND** it SHALL be distinguishable from the no-bridge failure
- **AND** it SHALL state whether the prompt was delivered, so a caller does not
  retry a prompt that already reached the bridge

#### Scenario: Record clears without the incumbent disconnecting
- **WHEN** a session has a live contention record
- **AND** the refused spawn is reclaimed, or the record's expiry elapses
- **THEN** the record SHALL be cleared while the incumbent remains connected
- **AND** a subsequent prompt SHALL report success as today

#### Scenario: Contention record does not outlive the episode
- **WHEN** a session with a live contention record disconnects — by clean close
  or by termination — or ends
- **THEN** the record SHALL be cleared
- **AND** a subsequent prompt on a healthy bridge for that id SHALL report
  success as today

#### Scenario: Prompt API still reports the existing no-bridge failure
- **WHEN** a prompt is submitted for a session with no live bridge
- **THEN** the API SHALL continue to report the failure as it does today

#### Scenario: Healthy session is unaffected
- **WHEN** a prompt is submitted for a session with exactly one live bridge
- **THEN** the API SHALL report success as it does today
