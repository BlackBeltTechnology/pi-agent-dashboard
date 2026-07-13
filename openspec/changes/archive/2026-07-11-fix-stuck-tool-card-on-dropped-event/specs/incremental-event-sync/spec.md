## ADDED Requirements

### Requirement: Stale running-tool reconcile
The client SHALL reconcile a tool-result row that has been in `running` state for
longer than a conservative threshold (`STALE_TOOL_MS`) without a `tool_execution_end`,
via a one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId`. The reconcile
channel is HTTP, independent of the WebSocket send buffer whose back-pressure can drop
a live terminal event, so the heal cannot be re-dropped by the same condition. The
client SHALL apply only the authoritative server result and SHALL NOT synthesize a
completion of its own.

#### Scenario: Dropped terminal event reconciles from REST
- **WHEN** a tool card's `tool_execution_end` was dropped on the server→browser hop
  (the event is still recorded in the server store), and the row has been `running`
  for more than `STALE_TOOL_MS`
- **THEN** the client SHALL fetch the tool result by `toolCallId`
- **AND** on a completed result (HTTP 200) SHALL flip the row to its terminal
  (complete/error) state without a manual page refresh

#### Scenario: Genuinely slow tool is not falsely completed
- **WHEN** a tool is legitimately still executing and the server has no
  `tool_execution_end` for it (HTTP 404 / in-flight)
- **THEN** the client SHALL keep the running spinner and re-arm the reconcile timer
- **AND** SHALL NOT synthesize a completion

#### Scenario: Evicted result cannot reconcile (known limitation)
- **WHEN** the server store has evicted the `tool_execution_end` under memory pressure
  and the REST route returns 404
- **THEN** the client SHALL leave the row running (recovered only by an in-app full
  replay (`lastSeq:0`) or bridge reconnect re-sync — a browser reload alone
  delta-subscribes from the durable replay cache and does not recover it); it SHALL NOT
  flip the row on a 404

### Requirement: Drop-site delivery instrumentation
Both silent event-drop points SHALL be observable. The server fanout SHALL, when it
skips a frame because `ws.bufferedAmount > MAX_WS_BUFFER`, increment a dropped-frame
counter and emit a rate-limited warning carrying `hop: "server→browser"`, `sessionId`,
`seq`, and `bufferedAmount`. The bridge `ConnectionManager` SHALL, when it evicts the
oldest buffered message on ring-buffer overflow, increment a dropped-frame counter and
emit a rate-limited warning carrying `hop: "bridge→server"` and the dropped message
type. Counters SHALL be exposed on the diagnostics/health surface.

#### Scenario: Server back-pressure drop is counted and logged
- **WHEN** the server fanout skips an event because `ws.bufferedAmount` exceeds
  `MAX_WS_BUFFER`
- **THEN** the server dropped-frame counter for that session SHALL increment
- **AND** a rate-limited warning with `hop`, `sessionId`, `seq`, and `bufferedAmount`
  SHALL be emitted (log-storms during a stall SHALL be rate-limited)

#### Scenario: Bridge ring-buffer eviction is counted and logged
- **WHEN** the bridge buffers an outgoing message while disconnected and overflow
  forces `buffer.shift()`
- **THEN** the bridge dropped-frame counter SHALL increment
- **AND** a rate-limited warning with `hop: "bridge→server"` and the dropped message
  type SHALL be emitted

#### Scenario: Counters are exposed for observability
- **WHEN** the diagnostics/health payload is requested
- **THEN** it SHALL include the per-hop dropped-frame counters
