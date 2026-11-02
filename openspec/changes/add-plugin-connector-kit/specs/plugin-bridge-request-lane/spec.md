## MODIFIED Requirements

### Requirement: Bounded waiting and payloads
Each call SHALL fail with the named error in these cases:
- `timeout` if no reply arrives within 15 seconds;
- `disconnected` if the dashboard connection drops after the request frame was sent and before the reply;
- `unavailable` if the dashboard bridge is not present, or if the bridge could not send the request frame (socket not open or send failure), so the request never left the bridge;
- `request_too_large` for a request payload over 256 KiB;
- `reply_too_large` for a reply over 256 KiB;
- `reply_not_serializable` when the handler returns a value that cannot be serialized.

A late reply SHALL be discarded.

#### Scenario: Timeout
- **WHEN** the server handler never resolves
- **THEN** the call resolves with `timeout` after 15 seconds and a later reply is ignored

#### Scenario: Disconnect
- **WHEN** the bridge's dashboard connection closes while a request is pending
- **THEN** the call resolves with `disconnected`

#### Scenario: Old or absent bridge
- **WHEN** a plugin bridge sends a request in a session without the dashboard bridge
- **THEN** the call resolves immediately with `unavailable`

#### Scenario: Non-serializable reply
- **WHEN** the handler returns an object with a circular reference
- **THEN** the call resolves with `reply_not_serializable`

#### Scenario: Frame could not be sent
- **WHEN** the dashboard bridge is installed but its socket is not open when a request is made
- **THEN** the call resolves immediately with `unavailable`, not `disconnected`, and nothing is queued
