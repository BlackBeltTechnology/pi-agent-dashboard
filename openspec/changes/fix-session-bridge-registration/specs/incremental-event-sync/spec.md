## MODIFIED Requirements

### Requirement: Drop-site delivery instrumentation
Both silent event-drop points SHALL be observable. The server fanout SHALL, when it
skips a frame because `ws.bufferedAmount > MAX_WS_BUFFER`, increment a dropped-frame
counter and emit a rate-limited warning carrying `hop: "server→browser"`, `sessionId`,
`seq`, and `bufferedAmount`. The bridge `ConnectionManager` SHALL, when it evicts the
oldest buffered message on ring-buffer overflow, increment a dropped-frame counter and
emit a rate-limited warning carrying `hop: "bridge→server"` and the dropped message
type. The bridge warning SHALL also carry per-type counts of every frame dropped since the
buffer last flushed, so a throttled line cannot hide what was lost. Counters SHALL be exposed on the diagnostics/health surface.

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

#### Scenario: Counters are exposed for observability
- **WHEN** the diagnostics/health payload is requested
- **THEN** it SHALL include the per-hop dropped-frame counters

#### Scenario: Overflow warning aggregates by type
- **WHEN** 9 990 `event_forward` frames and 3 `tool_call` frames are evicted between two warnings
- **THEN** the warning SHALL report `event_forward` and `tool_call` with their counts, not only the first dropped type

## ADDED Requirements

### Requirement: Bridge send buffer never evicts control frames
While the WebSocket is not open, the bridge send buffer SHALL evict only non-control frames on overflow, oldest first. Control frames (`session_register`, `session_unregister`, `replay_complete`, `commands_list`, `models_list`, `providers_list`) SHALL be retained, bounded at 256, and flushed in their original wire order relative to every retained frame. If the control bound is exceeded the oldest control frame is evicted and counted.

#### Scenario: Register survives a replay flood
- **WHEN** `session_register` is buffered before the socket opens, followed by more `event_forward` frames than `maxBufferSize`
- **THEN** the flush on open SHALL send `session_register` first and the most recent non-control frames after it
- **AND** the evicted frames SHALL be counted per type

#### Scenario: Wire order preserved after eviction
- **WHEN** control and non-control frames are interleaved in the buffer and overflow evicts non-control frames
- **THEN** the retained frames SHALL be sent in their original send order

#### Scenario: Control bound is finite
- **WHEN** more than 256 control frames are buffered while disconnected
- **THEN** the oldest control frame SHALL be evicted and counted
- **AND** the buffer SHALL NOT grow beyond `maxBufferSize` plus 256 frames
