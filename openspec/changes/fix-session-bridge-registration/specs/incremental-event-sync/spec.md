## MODIFIED Requirements

### Requirement: Drop-site delivery instrumentation
Both silent event-drop points SHALL be observable. The server fanout SHALL, when it
skips a frame because `ws.bufferedAmount > MAX_WS_BUFFER`, increment a dropped-frame
counter and emit a rate-limited warning carrying `hop: "server→browser"`, `sessionId`,
`seq`, and `bufferedAmount`. The bridge `ConnectionManager` SHALL, when it evicts the
oldest buffered message that is not a control frame (see "Bridge send buffer never
evicts control frames") on ring-buffer overflow, increment a dropped-frame counter
and emit a rate-limited warning carrying `hop: "bridge→server"` and the dropped
message type. A buffered control frame SHALL NOT be evicted except when the control
bound of that requirement is exceeded. The bridge warning SHALL also carry per-type
counts of every frame dropped since the buffer last flushed (control-bound evictions
included), so a throttled line cannot hide what was lost.
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
- **THEN** the oldest non-control frames SHALL be evicted instead
- **AND** the `session_register` SHALL be sent when the socket opens, ahead of the
  frames buffered after it

#### Scenario: Buffered session_unregister survives overflow on a session switch
- **WHEN** a session switch buffers `session_unregister` for the old session and
  `session_register` for the new one, and more frames than the ring capacity follow
- **THEN** both frames SHALL be kept, in that order
- **AND** the server SHALL remove the old session before registering the new one

#### Scenario: Overflow warning aggregates by type
- **WHEN** 9 990 `event_forward` frames and 3 `session_heartbeat` frames are evicted since the buffer last flushed
- **THEN** the warning SHALL report `event_forward` and `session_heartbeat` with their counts, not only the first dropped type

#### Scenario: Counters are exposed for observability
- **WHEN** the diagnostics/health payload is requested
- **THEN** it SHALL include the per-hop dropped-frame counters

## ADDED Requirements

### Requirement: Bridge send buffer never evicts control frames
While the WebSocket is not open, the bridge send buffer SHALL keep control frames (`session_register`, `session_unregister`, `replay_complete`, `commands_list`, `models_list`, `providers_list`) apart from other frames. Overflow means more than `maxBufferSize` non-control frames and SHALL evict only the oldest one. Control frames SHALL be bounded at 256 (oldest evicted and counted beyond that); retained frames SHALL flush in send order.

#### Scenario: Other control frames survive a replay flood
- **WHEN** `session_register`, `commands_list` and `replay_complete` are buffered around more `event_forward` frames than `maxBufferSize` before the socket opens
- **THEN** the flush on open SHALL send all three control frames and the most recent non-control frames
- **AND** the evicted frames SHALL be counted per type

#### Scenario: Wire order preserved after eviction
- **WHEN** control and non-control frames are interleaved in the buffer and overflow evicts non-control frames
- **THEN** the retained frames SHALL be sent in their original send order

#### Scenario: Control bound is finite
- **WHEN** more than 256 control frames are buffered while disconnected
- **THEN** the oldest control frame SHALL be evicted and counted
- **AND** the buffer SHALL NOT hold more than `maxBufferSize` non-control frames plus 256 control frames

#### Scenario: Eviction does not re-parse frames
- **WHEN** a 10 000-frame flood overflows the buffer
- **THEN** the frame type SHALL have been read once at send time and eviction SHALL NOT call `JSON.parse` on buffered frames
