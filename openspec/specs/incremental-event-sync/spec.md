## Purpose

Minimizes data transfer between server and browser by using delta event replay instead of full replay on every reconnect. The browser tracks the highest received sequence number per session and sends it on subscribe; the server returns only new events. The bridge sends entry counts so the server can skip wiping the event store on reconnect when the session hasn't changed.
## Requirements
### Requirement: Client-side sequence tracking
The browser client SHALL maintain a `maxSeqMap: Map<string, number>` that tracks the highest event sequence number received per session. The map SHALL be updated on every `event` message (from `msg.seq`) and every `event_replay` batch (from the last event's `seq` in the batch).

#### Scenario: Live event updates maxSeq
- **WHEN** the browser receives an `event` message with `sessionId: "s1"` and `seq: 42`
- **THEN** `maxSeqMap.get("s1")` SHALL be updated to `42` (if greater than current value)

#### Scenario: Replay batch updates maxSeq
- **WHEN** the browser receives an `event_replay` message with events `[{seq:10,...}, {seq:11,...}, {seq:12,...}]`
- **THEN** `maxSeqMap` for that session SHALL be updated to `12`

#### Scenario: Empty replay does not reset maxSeq
- **WHEN** the browser receives an `event_replay` with an empty events array
- **THEN** `maxSeqMap` for that session SHALL remain unchanged

### Requirement: Delta subscribe using lastSeq
The browser client SHALL send the tracked `maxSeq` as `lastSeq` when subscribing to a session. The server SHALL return only events with `seq > lastSeq`.

#### Scenario: Re-subscribe after reconnect with existing state
- **WHEN** the browser reconnects and re-subscribes to session "s1" with `maxSeqMap.get("s1") === 50`
- **THEN** the subscribe message SHALL include `lastSeq: 50`
- **AND** the server SHALL return only events with `seq > 50`

#### Scenario: First-time subscribe
- **WHEN** the browser subscribes to a session not in `maxSeqMap`
- **THEN** the subscribe message SHALL include `lastSeq: 0` (full replay)

### Requirement: Reset seq on session_state_reset
When the browser receives a `session_state_reset` message for a session, it SHALL reset that session's entry in `maxSeqMap` to `0` and clear the session's `SessionState` (existing behavior). The next event replay from the server will be a full replay.

#### Scenario: Bridge reconnect triggers reset
- **WHEN** the browser receives `session_state_reset` for session "s1"
- **THEN** `maxSeqMap.get("s1")` SHALL be reset to `0`
- **AND** the session's `SessionState` SHALL be reset to initial state

### Requirement: Server detects stale lastSeq
When a browser subscribes with `lastSeq` greater than the server's highest stored seq for that session, the server SHALL send `session_state_reset` followed by a full replay from seq 1.

#### Scenario: Client has higher seq than server (server restarted)
- **WHEN** browser subscribes with `lastSeq: 500` but server's max stored seq for that session is `10`
- **THEN** server SHALL send `session_state_reset` for that session
- **AND** server SHALL replay all events from seq 1

#### Scenario: Client lastSeq within server range
- **WHEN** browser subscribes with `lastSeq: 50` and server has events up to seq `100`
- **THEN** server SHALL replay events with seq 51–100 (no reset needed)

### Requirement: Bridge event count for skip-wipe detection
The bridge extension SHALL include an `eventCount` field in the `session_register` message, representing the number of conversation entries in the current session. The server SHALL store this as `lastEntryCount` on the `DashboardSession` and compare against it on subsequent reconnects to decide whether to wipe the event store.

#### Scenario: Event count matches — skip wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 200 }` and the server's stored `lastEntryCount` for session "s1" is `200` and events exist in the event store
- **THEN** the server SHALL NOT call `deleteEventsForSession("s1")`
- **AND** the server SHALL NOT send `session_state_reset` to browsers
- **AND** the server SHALL clear the `replayingSessions` flag after receiving `replay_complete`

#### Scenario: Event count mismatch — full wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 150 }` but the server's stored `lastEntryCount` for "s1" is `200`
- **THEN** the server SHALL call `deleteEventsForSession("s1")`
- **AND** the server SHALL send `session_state_reset` to browser subscribers

#### Scenario: No eventCount provided — full wipe (backward compat)
- **WHEN** bridge reconnects with `session_register` without `eventCount`
- **THEN** the server SHALL perform the existing full wipe behavior

#### Scenario: Session ID changed — always full wipe
- **WHEN** bridge reconnects with a different `sessionId` than previously registered on the same WebSocket
- **THEN** the server SHALL perform the full wipe regardless of `eventCount`

### Requirement: Suppress live events during paginated replay

When the server sends a paginated `event_replay` stream to a browser WebSocket — whether the subscribe was cold (`lastSeq: 0`, full replay of all stored events) or warm (`lastSeq > 0`, delta replay of seqs `> lastSeq`) — it SHALL suppress live `event` broadcasts to that specific WebSocket until the replay completes. Suppression applies whenever the server has a non-empty event set to replay (`events.length > 0`).

This rule exists because the client's `event_replay` reset rule

```
shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= maxSeq)
```

uses a single per-session `maxSeq` that is bumped by both `event_replay` batches AND live `event` messages. If a live `event` interleaves between two paginated `event_replay` batches it advances `maxSeq` past the next batch's `firstSeq`, causing the next batch to misfire `shouldReset = true`, wipe the partially-built `SessionState`, and rebuild from only that batch's events. Net effect: the chat shows only the tail. Suppression+catch-up preserves the invariant that paginated `event_replay` batches arrive monotonically with no live-event interleaving on the same WebSocket.

#### Scenario: Cold subscribe with stored events suppresses live broadcasts (regression)
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 0` and the in-memory event store holds 228 events for "s1"
- **AND** the server begins sending paginated `event_replay` batches (50 per batch)
- **AND** a new live event with `seq: 105` arrives after batch B2 (`firstSeq=51, lastSeq=100`) but before batch B3 (`firstSeq=101`)
- **THEN** the server SHALL NOT send `event { seq: 105 }` to browser B until the paginated replay has completed (`isLast: true` sent)
- **AND** browser B's `maxSeqMap.get("s1")` SHALL NOT be advanced past `100` before batch B3 (`firstSeq=101`) arrives
- **AND** batch B3 SHALL NOT trigger the `shouldReset` rule on the client

#### Scenario: Warm subscribe (delta) live event during replay is suppressed
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 50` and the server starts replaying events 51..100
- **AND** a new live event with `seq: 101` arrives during the replay
- **THEN** the server SHALL NOT send `event { seq: 101 }` to browser B until the replay batch with `isLast: true` has been sent
- **AND** after replay completes, the server SHALL resume live broadcasting to browser B
- **AND** the server SHALL send event 101 to browser B (either as part of a catch-up `event_replay` if it falls within range, or as a live event after replay)

#### Scenario: Other browsers not replaying receive live events immediately
- **WHEN** browser A is subscribed and not replaying, and browser B is mid-replay (cold or warm)
- **AND** a new live event arrives
- **THEN** the server SHALL broadcast the event to browser A immediately
- **AND** the server SHALL suppress the event for browser B until B's replay completes

#### Scenario: Events during suppression are not lost — catch-up batch
- **WHEN** events with seqs 229, 230, 231 arrive while browser B is mid-replay (cold subscribe, paginated through seqs 1..228)
- **THEN** all three events SHALL be stored in the event store
- **AND** after the paginated replay completes, the server SHALL send events 229..231 to browser B as a single `event_replay { isLast: true }` catch-up batch (via `clearReplaying(ws, sessionId, lastSent)`)

#### Scenario: Empty event set — no suppression marker set
- **WHEN** browser B subscribes to a session whose event store exists but is empty (`events.length === 0` for the subscribe range)
- **THEN** the server SHALL NOT call `markReplaying` for that WebSocket+session pair
- **AND** any subsequent live `event` SHALL be broadcast to browser B immediately

### Requirement: Stale running-tool reconcile
The client SHALL reconcile a tool-result row that has been in `running` state for
longer than a conservative threshold (`STALE_TOOL_MS`) without a `tool_execution_end`,
via a one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId`. The reconcile
channel is HTTP, independent of the WebSocket send buffer whose back-pressure can drop
a live terminal event, so the heal cannot be re-dropped by the same condition. The
client SHALL apply only the authoritative server result on HTTP 200 and SHALL NOT
synthesize a completion from the reconcile path itself. When the authoritative result
is unrecoverable (repeated HTTP 404) the row is finalized only by the separate
Superseded terminal heal below, and only under its stricter proof-of-completion
condition.

#### Scenario: Dropped terminal event reconciles from REST
- **WHEN** a tool card's `tool_execution_end` was dropped on the server→browser hop
  (the event is still recorded in the server store), and the row has been `running`
  for more than `STALE_TOOL_MS`
- **THEN** the client SHALL fetch the tool result by `toolCallId`
- **AND** on a completed result (HTTP 200) SHALL flip the row to its terminal
  (complete/error) state without a manual page refresh

#### Scenario: Genuinely slow tool is not falsely completed
- **WHEN** a tool is legitimately still executing, its turn is still the newest turn,
  and the server has no `tool_execution_end` for it (HTTP 404 / in-flight)
- **THEN** the client SHALL keep the running spinner and re-arm the reconcile timer
- **AND** SHALL NOT synthesize a completion

#### Scenario: Evicted result is finalized by supersede, not left running
- **WHEN** the server store has evicted the `tool_execution_end` under memory pressure
  and the REST route returns 404 repeatedly
- **THEN** the reconcile path SHALL NOT flip the row on a 404 (unchanged)
- **AND** finalization is delegated to the Superseded terminal heal, which fires only
  when a later assistant `message_start` proves the tool finished

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

### Requirement: Superseded terminal heal
The client SHALL finalize a `running` tool row whose authoritative result is
unrecoverable when the transcript proves the tool completed. A row is eligible only when
BOTH hold: (a) the base reconcile has returned HTTP 404 at least `SUPERSEDE_MIN_404`
times for that row (the store has no result), AND (b) at least one assistant *inference*
strictly later than the inference that emitted the tool call has been applied for the
session, where an inference boundary is an assistant `message_start` (tracked as a
monotonic `assistantInferenceSeq`) — NOT `message_end` (which fires after its own
inference's tool), NOT the coarse per-user-cycle `turnCount`, and NOT a sibling
`tool_start` in the same inference. On
eligibility the client SHALL synthesize a `tool_execution_end` via the existing
`toolCallId`-keyed reducer path with `isError: false`, a sentinel result body, and a
`healedBy: "superseded"` detail, and SHALL increment a supersede-heal counter and render
a distinguishable badge. The synthesized state is `complete`; no new status enum value
is introduced.

#### Scenario: Unrecoverable-but-superseded card is finalized
- **WHEN** a tool row has been `running` past `STALE_TOOL_MS`, the reconcile route has
  returned 404 at least `SUPERSEDE_MIN_404` times, and a later assistant `message_start`
  exists after the tool call's inference
- **THEN** the client SHALL flip the row to `complete` with `healedBy: "superseded"` and
  a "result not captured (recovered)" body
- **AND** SHALL increment the supersede-heal counter and badge the card

#### Scenario: Parallel in-flight tool in the current inference is not falsely completed
- **WHEN** a tool row is `running`, its inference is still the newest (no later assistant
  `message_start` exists yet), even if a sibling `tool_start` in the same inference has
  appeared, or the emitting inference's own `message_end` has fired
- **THEN** the client SHALL NOT apply the supersede heal
- **AND** SHALL keep the running spinner

#### Scenario: Recovery still preferred — real result wins over placeholder
- **WHEN** a row was previously finalized by the supersede heal (`healedBy: "superseded"`)
  and a genuine `tool_execution_end` later arrives (late reconcile 200, in-app full
  replay, or bridge reconnect re-sync)
- **THEN** the reducer SHALL overwrite the placeholder with the authoritative result
- **AND** a superseded placeholder SHALL NOT overwrite a real completion nor another
  superseded placeholder

#### Scenario: Fallback never fires before recovery is exhausted
- **WHEN** the base reconcile returns HTTP 200 before `SUPERSEDE_MIN_404` 404s accrue
- **THEN** the row is healed by the base reconcile with its real body
- **AND** the supersede heal SHALL NOT fire for that row

### Requirement: Store-trim instrumentation
The in-memory event store SHALL make its shed paths observable. When
`trimBufferToLimit` drops events over the per-session cap it SHALL count the
total events dropped and, among them, how many were `tool_execution_end`; per
session it SHALL accumulate a trim total. When `evictIfNeeded` drops whole
session buffers under the cross-session LRU cap it SHALL count the sessions
evicted. These counters SHALL be cumulative for the process lifetime (not reset
on read) and SHALL be exposed via a `getTrimStats()` accessor on the store handle
returning `{ trimmedEvents: { total, toolExecutionEnd, bySession }, evictedSessions }`.
The `GET /api/health` payload SHALL carry these counters under a `storeTrim`
field, additively, without altering any existing field.

#### Scenario: Per-session trim of terminal events is counted
- **WHEN** a session exceeds the per-session event cap and `trimBufferToLimit`
  drops entries that include one or more `tool_execution_end` events
- **THEN** `getTrimStats().trimmedEvents.total` SHALL include every dropped event
- **AND** `getTrimStats().trimmedEvents.toolExecutionEnd` SHALL count exactly the
  dropped `tool_execution_end` events
- **AND** `getTrimStats().trimmedEvents.bySession` SHALL attribute the drop to the
  originating session

#### Scenario: Cross-session eviction is counted
- **WHEN** the number of cached session buffers exceeds the LRU cap and
  `evictIfNeeded` deletes one or more session buffers
- **THEN** `getTrimStats().evictedSessions` SHALL increment by the number of
  buffers deleted

#### Scenario: No trim yields zero counters
- **WHEN** a session stays within both the per-session and cross-session caps
- **THEN** `getTrimStats()` SHALL report zero for every counter
- **AND** `GET /api/health#storeTrim` SHALL report the same zeros

#### Scenario: Counters are exposed on the health surface
- **WHEN** the `/api/health` payload is requested
- **THEN** it SHALL include a `storeTrim` object with `trimmedEvents.total`,
  `trimmedEvents.toolExecutionEnd`, `trimmedEvents.bySession`, and
  `evictedSessions`, alongside the existing `droppedFrames` field

