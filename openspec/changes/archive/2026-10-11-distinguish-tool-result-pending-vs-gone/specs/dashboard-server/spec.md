## MODIFIED Requirements

### Requirement: GET /api/sessions/:sessionId/tool-result/:toolCallId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/tool-result/:toolCallId` returning the full final result string for a completed tool call, looked up from `MemoryEventStore`. This endpoint exists so the UI can fetch the complete output on demand when the truncated rendered text was capped to its last N lines, and so the client's stale-tool reconcile can recover a terminal event it never received.

The route SHALL keep both of its existing guards: the network guard used by other session routes AND the per-session principal/owner gate (`gateHttpSession`). No outcome below SHALL be reachable for a request the owner gate rejects.

**Evicted-end record.** Whenever the store drops a stored `tool_execution_end` under its per-session or global memory bounds, it SHALL record that event's `toolCallId` in a per-session evicted-end record, UNLESS the event carries a `healedBy` marker (synthesized ends, e.g. the session-end heal or a replay orphan-close, which can describe a call that is still running) or the id exceeds 256 characters. A live top-level `tool_execution_start` for an id SHALL remove that id from the record. The record SHALL be bounded (oldest entries dropped first beyond a fixed capacity), SHALL live and die with the session's event buffer (freed when the buffer is deleted or evicted), and SHALL NOT be populated by any other path. An id in the record is a fact: that call genuinely completed and its stored result was dropped.

**In-flight hint.** The server SHALL keep, per session, the set of top-level `toolCallId`s whose LIVE `tool_execution_start` it has ingested without a LIVE `tool_execution_end` (nested calls carrying `parentToolCallId` excluded; events ingested during a bridge replay ignored). The set SHALL be emptied on the session's live `agent_settled` (the turn's terminal signal), on every `session_register`, when the session ends, and when the session is removed; an emptied session SHALL hold no entry, and a session SHALL hold at most 256 ids. Because it is cleared on `session_register`, a call already running across a bridge reconnect is answered `404` (as today) until it ends. The set is a hint used only to choose between `202` and `404`; no client SHALL finalize a tool row on its account.

The `pending` flag SHALL match only when the query carries a single `pending` value equal to the string `1`; repeated or array-shaped values SHALL NOT match. Responses, evaluated in this order:

| # | Condition | Status | Body |
|---|---|---|---|
| 1 | a `tool_execution_end` for the id is stored | `200` | `{ result, isError }` |
| 2 | the id is in the session's evicted-end record | `410` | `{ error: "result no longer available" }` |
| 3 | the id is in the in-flight hint AND the request carries `pending=1` | `202` | `{ pending: true }` |
| 4 | otherwise (in flight without `pending=1`, unknown call or session, evicted-end record overflowed or freed) | `404` | `{ error: "tool call still in flight or unknown" }` |

#### Scenario: Completed tool call returns full result
- **WHEN** a session has emitted a `tool_execution_end` event for `toolCallId = "abc"` with a 1000-line `result`
- **AND** the client requests `GET /api/sessions/:sessionId/tool-result/abc`
- **THEN** the response SHALL be `200` with `{ result: "<full 1000-line string>", isError: false }`

#### Scenario: Tool call still in flight
- **WHEN** the session has emitted a live `tool_execution_start` for `toolCallId = "abc"` but no `tool_execution_end`
- **AND** the client requests `GET /api/sessions/:sessionId/tool-result/abc?pending=1`
- **THEN** the response SHALL be `202` with `{ pending: true }`
- **AND** the same request without `pending=1` SHALL be answered `404` with `{ error: "tool call still in flight or unknown" }` (legacy clients)

#### Scenario: In-flight answer survives a trimmed start
- **WHEN** `abc` is in the in-flight hint and the store trim has dropped its stored `tool_execution_start`
- **THEN** a request with `pending=1` SHALL still be answered `202`

#### Scenario: Tool call evicted from memory buffer
- **WHEN** the per-session buffer has dropped the stored `tool_execution_end` for `abc` under memory pressure
- **THEN** the response SHALL be `410` with `{ error: "result no longer available" }`, with or without `pending=1`

#### Scenario: Synthesized ends are never recorded as evicted
- **WHEN** a reconnect replay stores a synthesized `tool_execution_end` for a still-running `abc` (`healedBy: "session_ended"`) and the store then trims it
- **THEN** `abc` SHALL NOT be in the evicted-end record
- **AND** a request for `abc` SHALL NOT be answered `410`

#### Scenario: A live start invalidates a recorded eviction
- **WHEN** `abc` is in the evicted-end record and a live top-level `tool_execution_start` for `abc` is ingested
- **THEN** `abc` SHALL be removed from the record
- **AND** a `pending=1` request for `abc` SHALL be answered `202`, not `410`

#### Scenario: Re-stored end wins over the eviction record
- **WHEN** `abc` is in the evicted-end record and a later replay stores a `tool_execution_end` for `abc` again
- **THEN** the response SHALL be `200` with that result

#### Scenario: Evicted-end record is bounded
- **WHEN** more `tool_execution_end` events are dropped for one session than the record's capacity
- **THEN** the record SHALL hold at most its capacity, keeping the most recently dropped ids
- **AND** a request for an id that fell out of the record SHALL be answered `404`

#### Scenario: Turn end empties the in-flight hint
- **WHEN** a live `tool_execution_start` for `abc` was ingested, its end was lost, and the session then emits a live `agent_settled`
- **THEN** a `pending=1` request for `abc` SHALL NOT be answered `202`

#### Scenario: Pending flag is exact
- **WHEN** an in-flight call is requested with `pending=true`, `pending=0`, or `pending=1&pending=1`
- **THEN** the response SHALL be `404`, as for a request without the flag

#### Scenario: Unknown session
- **WHEN** the client requests a tool result for a `sessionId` the server does not know
- **THEN** the response SHALL be `404`
