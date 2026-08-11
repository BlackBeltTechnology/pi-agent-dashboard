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
is `OPEN` when the session's bridge is in a contended or ambiguous state, and a
contended session SHALL be distinguishable from a healthy one by API callers.

#### Scenario: Prompt API does not claim success for a contended bridge
- **WHEN** a prompt is submitted for a session whose bridge is contended or
  ambiguous
- **THEN** the API SHALL NOT return a plain success result
- **AND** the response SHALL identify the bridge state as the reason

#### Scenario: Prompt API still reports the existing no-bridge failure
- **WHEN** a prompt is submitted for a session with no live bridge
- **THEN** the API SHALL continue to report the failure as it does today

#### Scenario: Healthy session is unaffected
- **WHEN** a prompt is submitted for a session with exactly one live bridge
- **THEN** the API SHALL report success as it does today
