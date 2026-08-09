## ADDED Requirements

### Requirement: Superseded `tool_execution_update` events are collapsed at retention

The in-memory event buffer SHALL retain at most ONE `tool_execution_update`
event per `toolCallId` per session: the one with the HIGHEST sequence number.
When an update for a `toolCallId` already present in the buffer is inserted, the
store SHALL drop the previously retained update for that `toolCallId`.

Collapse SHALL be keyed strictly on `data.toolCallId`. An update event carrying
no `toolCallId` SHALL be retained unconditionally (fail-open).

Collapse SHALL apply at RETENTION only. The event being inserted SHALL always be
stored, so a caller that re-reads it by the returned `seq` (the broadcast path)
observes it unchanged. Collapse SHALL NOT renumber surviving events; `getEvents`
filters by seq and already tolerates seq gaps.

Collapse SHALL NOT remove the highest-seq event in the buffer, so `getMaxSeq`
never regresses.

Collapse SHALL add amortized O(1) work per insert; it SHALL NOT introduce a scan
of the buffer per inserted event.

#### Scenario: Successive updates for one tool call retain only the newest

- **GIVEN** a session buffer containing `tool_execution_start` for `toolCallId`
  "t1" followed by `tool_execution_update` events for "t1" at seq 2, 3 and 4
- **WHEN** a further `tool_execution_update` for "t1" is inserted at seq 5
- **THEN** the buffer SHALL contain exactly ONE `tool_execution_update` for "t1"
- **AND** it SHALL be the seq-5 event
- **AND** the `tool_execution_start` at seq 1 SHALL still be present

#### Scenario: Updates for different tool calls do not collapse each other

- **GIVEN** interleaved `tool_execution_update` events for `toolCallId` "t1" and
  "t2"
- **WHEN** all of them are inserted
- **THEN** the buffer SHALL retain the newest update for "t1" AND the newest
  update for "t2"

#### Scenario: Replaying the collapsed buffer yields the same client state

- **GIVEN** a sequence of `tool_execution_update` events for one `toolCallId`
  whose `partialResult` is a full running snapshot (`{ content, details }`)
- **WHEN** the full uncollapsed sequence is folded by the client event reducer,
  and separately the collapsed buffer is folded by the same reducer
- **THEN** the resulting message `result`, message `toolDetails`, and `subagents`
  map entries SHALL be equivalent

#### Scenario: Final update survives so a live `tool_execution_end` keeps its details

- **GIVEN** a completed `Agent` tool call whose `tool_execution_end` is a LIVE
  event carrying NO `details` of its own
- **WHEN** the session buffer is replayed after collapse
- **THEN** the newest `tool_execution_update` for that `toolCallId` SHALL still be
  present so the end event resolves against the timeline it wrote
- **AND** the completed subagent SHALL render its timeline rather than a
  "not found" placeholder

#### Scenario: Update without a toolCallId is retained

- **WHEN** a `tool_execution_update` carrying no `data.toolCallId` is inserted
- **THEN** the store SHALL retain it and SHALL NOT drop any other event on its
  behalf

#### Scenario: The newest event in the buffer is never collapsed away

- **GIVEN** a buffer whose highest-seq event is a `tool_execution_update`
- **WHEN** collapse runs
- **THEN** `getMaxSeq(sessionId)` SHALL return that event's seq, unchanged

#### Scenario: Inserted event is readable by its returned seq

- **WHEN** `insertEvent` returns `seq` for a `tool_execution_update` that
  superseded an earlier one
- **THEN** `getEvent(sessionId, seq)` SHALL return that event, so the broadcast
  path re-reads it successfully

#### Scenario: Collapse does not make insertion super-linear

- **WHEN** 10 000 `tool_execution_update` events for a single `toolCallId` are
  inserted in a loop
- **THEN** the buffer SHALL hold exactly one of them at every observable point
- **AND** the total collapse work SHALL be O(events), NOT O(events × buffer
  length)

#### Scenario: Non-update event types are unaffected

- **GIVEN** a buffer containing `message_start`, `message_end`,
  `tool_execution_start` and `tool_execution_end` events
- **WHEN** collapse runs
- **THEN** none of those events SHALL be dropped by the collapse policy

### Requirement: Collapse instrumentation

The in-memory event store SHALL make the collapse path observable. `getTrimStats()`
SHALL expose a cumulative process-lifetime count of `tool_execution_update`
events dropped by collapse, alongside the existing trim and eviction counters.
The counter SHALL NOT reset on read.

#### Scenario: Collapsed updates are counted

- **WHEN** N superseded `tool_execution_update` events are dropped by collapse
- **THEN** `getTrimStats()` SHALL report a cumulative collapsed count of N

#### Scenario: Counter is independent of trim and eviction counters

- **WHEN** collapse drops an update AND a per-session trim drops a different
  event
- **THEN** the collapsed count and the trimmed count SHALL each reflect only
  their own policy
