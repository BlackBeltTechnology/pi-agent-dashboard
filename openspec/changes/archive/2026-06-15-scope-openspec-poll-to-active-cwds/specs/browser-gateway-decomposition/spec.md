## ADDED Requirements

### Requirement: Broadcast serializes payload once per fan-out

When broadcasting a message to all subscribed browser sockets, the gateway SHALL serialize the payload **exactly once** per `broadcast()` call and send the same serialized frame to every open socket, rather than re-serializing per recipient. This bounds per-broadcast CPU at O(payload) instead of O(payload × subscribers), which matters for large recurring payloads such as `openspec_update` for repositories with many changes.

Existing back-pressure and liveness guards SHALL be preserved: a socket whose `readyState` is not `OPEN` SHALL be skipped, and a socket whose `bufferedAmount` exceeds `MAX_WS_BUFFER` (when the limit is non-zero) SHALL be skipped.

#### Scenario: Single serialization regardless of subscriber count
- **WHEN** `broadcast(msg)` is called with three subscribed open sockets
- **THEN** the payload SHALL be serialized once
- **AND** each of the three sockets SHALL receive an identical frame

#### Scenario: Back-pressure drop still applies after serialize-once
- **WHEN** one subscribed socket has `bufferedAmount` greater than `MAX_WS_BUFFER` and `MAX_WS_BUFFER` is non-zero
- **THEN** that socket SHALL NOT receive the frame
- **AND** the other open sockets SHALL still receive the single serialized frame

#### Scenario: Closed socket skipped
- **WHEN** a subscribed socket's `readyState` is not `OPEN`
- **THEN** that socket SHALL be skipped without error and the remaining open sockets SHALL receive the frame
