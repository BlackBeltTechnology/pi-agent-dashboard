## MODIFIED Requirements

### Requirement: Drop-site delivery instrumentation
Both silent event-drop points SHALL be observable. The server fanout SHALL, when it
skips a frame because `ws.bufferedAmount > MAX_WS_BUFFER`, increment a dropped-frame
counter and emit a rate-limited warning carrying `hop: "server→browser"`, `sessionId`,
`seq`, and `bufferedAmount`. The bridge `ConnectionManager` SHALL, when it evicts the
oldest buffered message that is not a session lifecycle frame
(`session_register` or `session_unregister`) on ring-buffer overflow, increment a
dropped-frame counter and emit a rate-limited warning carrying `hop: "bridge→server"`
and the dropped message type. A buffered lifecycle frame SHALL NOT be evicted.
Counters SHALL be exposed on the diagnostics/health surface.

#### Scenario: Server back-pressure drop is counted and logged
- **WHEN** the server fanout skips an event because `ws.bufferedAmount` exceeds
  `MAX_WS_BUFFER`
- **THEN** the server dropped-frame counter for that session SHALL increment
- **AND** a rate-limited warning with `hop`, `sessionId`, `seq`, and `bufferedAmount`
  SHALL be emitted (log-storms during a stall SHALL be rate-limited)

#### Scenario: Bridge ring-buffer eviction is counted and logged
- **WHEN** the bridge buffers an outgoing message while disconnected and overflow
  forces an eviction
- **THEN** the bridge dropped-frame counter SHALL increment
- **AND** a rate-limited warning with `hop: "bridge→server"` and the dropped message
  type SHALL be emitted

#### Scenario: Buffered session_register survives overflow
- **WHEN** a `session_register` is buffered and more frames than the ring capacity
  follow it before the socket opens
- **THEN** the oldest non-lifecycle frames SHALL be evicted instead
- **AND** the `session_register` SHALL be sent when the socket opens, ahead of the
  frames buffered after it

#### Scenario: Buffered session_unregister survives overflow on a session switch
- **WHEN** a session switch buffers `session_unregister` for the old session and
  `session_register` for the new one, and more frames than the ring capacity follow
- **THEN** both lifecycle frames SHALL be kept, in that order
- **AND** the server SHALL remove the old session before registering the new one

#### Scenario: Counters are exposed for observability
- **WHEN** the diagnostics/health payload is requested
- **THEN** it SHALL include the per-hop dropped-frame counters
