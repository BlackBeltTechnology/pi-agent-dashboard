## ADDED Requirements

### Requirement: Prompt resync protocol message

The protocol SHALL define a browser→server message requesting that a session's bridge re-emit every prompt it is still awaiting an answer for. The server SHALL forward it to that session's bridge connection and SHALL correlate the reply back to the requesting socket, using the same requester-token mechanism as the existing subagent resync. The bridge SHALL respond by re-emitting each pending prompt over the prompt-request path, carrying the original prompt id, resolved component, and placement, plus the echoed requester token.

#### Scenario: Server forwards the resync request to the bridge
- **WHEN** the server receives a prompt resync request from a browser for session X
- **THEN** the server SHALL forward it to the bridge connection for session X
- **AND** SHALL record the requesting socket against the request token

#### Scenario: Bridge re-emits its pending prompts
- **GIVEN** a bridge awaiting answers to prompts `p1` and `p2`
- **WHEN** the bridge receives a prompt resync request
- **THEN** it SHALL emit a prompt request for `p1` and `p2` with their original ids, resolved components, and placements
- **AND** SHALL echo the requester token on each

#### Scenario: Reply routed to the requester
- **WHEN** the server receives a re-emitted prompt carrying a known requester token
- **THEN** it SHALL deliver the prompt to the recorded socket only
- **AND** SHALL apply the same tracking and derived session state as for a live prompt

#### Scenario: Token serves every prompt of one resync
- **GIVEN** a resync whose bridge reply carries two or more prompts with the same requester token
- **WHEN** the server routes them
- **THEN** each SHALL be delivered to the recorded socket
- **AND** the token SHALL remain valid for the rest of the reply

#### Scenario: Requester mid-replay still receives the reply
- **GIVEN** a requesting socket that is still applying an event replay
- **WHEN** its resync reply arrives
- **THEN** the reply SHALL be delivered rather than suppressed

#### Scenario: Unknown or expired requester token
- **WHEN** the server receives a re-emitted prompt whose requester token is unknown or expired
- **THEN** it SHALL fall back to the ordinary fan-out to the session's subscribers

#### Scenario: Bridge with no pending prompts stays silent
- **WHEN** a bridge with no unanswered prompt receives a prompt resync request
- **THEN** it SHALL emit nothing

#### Scenario: Unknown session
- **WHEN** the server receives a prompt resync request for a session with no connected bridge
- **THEN** the request SHALL be dropped without error

### Requirement: Pending-prompt replay is exempt from browser back-pressure shedding

When the server replays a session's tracked pending prompts to a browser socket — on subscribe, or in answer to a resync — those frames SHALL be delivered regardless of that socket's buffered amount, up to a fixed per-delivery maximum of 4 frames and below an absolute buffered-amount ceiling of `MAX_WS_BUFFER` + 1 MB. The replay occurs immediately after a full event replay, which is precisely when the socket is most likely to be saturated. The exemption SHALL NOT extend to the notify-log replay or to transcript frames.

#### Scenario: Replay after a saturating full event replay
- **WHEN** a browser subscribes and the resulting event replay pushes the socket's buffered amount past the back-pressure threshold
- **AND** the session has tracked pending prompts
- **THEN** each tracked pending prompt up to the per-delivery maximum SHALL be sent to that browser

#### Scenario: Notify-log replay remains guarded
- **WHEN** the notify-log replay runs on a socket past the back-pressure threshold
- **THEN** its frames SHALL be dropped and counted as before
