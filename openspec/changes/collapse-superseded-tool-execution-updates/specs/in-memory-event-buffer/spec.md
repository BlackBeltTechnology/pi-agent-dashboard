## ADDED Requirements

### Requirement: Superseded `tool_execution_update` events are collapsed at retention

The in-memory event buffer SHALL drop a retained `tool_execution_update` for a
`toolCallId` when a later update for the same `toolCallId` **subsumes** it, so
that in the common case exactly one update per `toolCallId` is retained.

Collapse SHALL be keyed strictly on `data.toolCallId`. An update event carrying
no `toolCallId` SHALL be retained unconditionally (fail-open).

**Subsumption test.** Let `p` be the currently retained update for a
`toolCallId` and `s` the incoming one. Resolve each event's subagent details as
`data.partialResult.details` ONLY — matching how the consumer reads an update. A
top-level `data.details` SHALL NOT be used to resolve an update's details.

- If NEITHER event carries resolved details, `s` SHALL subsume `p`
  (the consumer path is an unconditional overwrite).
- Otherwise `s` SHALL subsume `p` only when ALL of the following hold:
  - every key present in `p`'s details is also present in `s`'s details AND holds
    a value of the same JS type, because the consumer extracts each detail field
    type-conditionally;
  - when `p`'s `details.entries` is a non-empty array, `s`'s `details.entries` is
    also a non-empty array;
  - when `p` sets the rendered result, `s` SHALL also set it. An update sets the
    rendered result either by yielding extractable text from
    `partialResult.content` (a SIBLING of `details`) or by carrying a non-object
    `partialResult`, which the consumer renders directly. Both sources SHALL be
    considered; `content` is NOT the only one.
- When `s` does not subsume `p`, BOTH SHALL be retained.

The subsumption test SHALL compare the key SET generically. It SHALL NOT
enumerate a hardcoded list of detail field names, so a field added to the
consumer later is covered without changing this policy.

**Creating-tick retention.** The FIRST update per `toolCallId` carrying
`details.agentId` SHALL be retained and SHALL NOT be collapsed away, because the
consumer derives some subagent fields on a FIRST-wins basis from whichever event
creates the map entry. Retention per tool call is therefore at most the creating
update plus the newest update, plus any non-subsumed intermediates.

Collapse SHALL apply at RETENTION only. The event being inserted SHALL always be
stored, so a caller that re-reads it by the returned `seq` (the broadcast path)
observes it unchanged. Collapse SHALL NOT renumber surviving events; `getEvents`
filters by seq and already tolerates seq gaps.

Collapse SHALL NOT remove the highest-seq event in the buffer, so `getMaxSeq`
never regresses.

The retained-update index SHALL be keyed by sequence number, NEVER by array
position, because the per-session trim rebuilds the event array wholesale and
`tool_execution_update` is not an essential chat event. Removal SHALL be
performed only after VERIFYING that the located entry still exists, is a
`tool_execution_update`, and carries the same `toolCallId`; a failed lookup SHALL
be a no-op. A negative or unresolved index SHALL NEVER be passed to an array
removal.

The index SHALL track the pinned creating sequence and the current newest
sequence as INDEPENDENT values per `toolCallId`. A single sequence per
`toolCallId` is insufficient: when the creating update is also the current
newest, a subsuming successor would otherwise be free to collapse the very event
the creating-tick rule pins.

Collapse SHALL be understood as conditional on events retaining a `toolCallId`.
An event reduced to the bounded truncation placeholder carries no `toolCallId`
and SHALL therefore be retained unconditionally, yielding no collapse for that
event.

#### Scenario: Successive subsuming updates for one tool call retain only the newest

- **GIVEN** a session buffer containing `tool_execution_start` for `toolCallId`
  "t1" followed by `tool_execution_update` events for "t1" at seq 2, 3 and 4,
  each carrying the same detail keys
- **WHEN** a further subsuming `tool_execution_update` for "t1" is inserted at
  seq 5
- **THEN** the buffer SHALL contain exactly ONE `tool_execution_update` for "t1"
- **AND** it SHALL be the seq-5 event
- **AND** the `tool_execution_start` at seq 1 SHALL still be present

#### Scenario: A non-subsuming tick retains both events

- **GIVEN** a retained `tool_execution_update` for "t1" whose details carry
  `agentSessionId`
- **WHEN** a later `tool_execution_update` for "t1" arrives WITHOUT
  `agentSessionId`
- **THEN** BOTH updates SHALL be retained
- **AND** a subsequent update that carries `agentSessionId` again SHALL subsume
  only the update it is compared against, never a non-subsumed earlier one

#### Scenario: An empty `entries` tick does not evict a populated timeline

- **GIVEN** a retained `tool_execution_update` for "t1" whose
  `details.entries` is a non-empty array
- **WHEN** a later `tool_execution_update` for "t1" arrives with
  `details.entries` as an EMPTY array
- **THEN** BOTH updates SHALL be retained

#### Scenario: Updates for different tool calls do not collapse each other

- **GIVEN** interleaved `tool_execution_update` events for `toolCallId` "t1" and
  "t2"
- **WHEN** all of them are inserted
- **THEN** the buffer SHALL retain the newest update for "t1" AND the newest
  update for "t2"

#### Scenario: Replaying the collapsed buffer yields the same client state

- **GIVEN** a sequence of `tool_execution_update` events for one `toolCallId`
  that INCLUDES non-subsuming ticks — one omitting `agentSessionId`, one whose
  `details.entries` is empty, one carrying no extractable
  `partialResult.content`, and one whose `partialResult` is a plain string
  followed by a structured update that sets no rendered result
- **AND** the folded subsequence contains NO `tool_execution_end` carrying
  `result` or `details`, because such an event overwrites both fields and would
  satisfy the assertion independently of the collapsed updates
- **WHEN** the full uncollapsed sequence is folded by the client event reducer,
  and separately the collapsed buffer is folded by the same reducer
- **THEN** the resulting message `result`, message `toolDetails`, and `subagents`
  map entries SHALL be equivalent
- **AND** the subagent entry's `type` and `description` SHALL be equal by VALUE,
  not merely present
- **AND** the `subagents` map SHALL still be reachable under BOTH the agent id
  and the `agentSessionId` key
- **AND** this scenario SHALL fail if the subsumption gate or the creating-tick
  retention is removed — a fixture of uniform full snapshots does NOT satisfy
  this scenario

#### Scenario: The entry-creating update is never collapsed away

- **GIVEN** the first `tool_execution_update` for "t1" carrying `details.agentId`
  with a given `subagentType` and `description`
- **WHEN** many later subsuming updates for "t1" are inserted, including some
  carrying a different `subagentType`
- **THEN** the creating update SHALL still be present in the buffer
- **AND** the folded subagent entry's `type` and `description` SHALL match the
  creating update's values

#### Scenario: Update without a toolCallId is retained

- **WHEN** a `tool_execution_update` carrying no `data.toolCallId` is inserted
- **THEN** the store SHALL retain it and SHALL NOT drop any other event on its
  behalf

#### Scenario: A trim that removed the retained update does not corrupt a later collapse

- **GIVEN** a retained `tool_execution_update` for "t1" that the per-session trim
  subsequently drops (updates are non-essential and the trim rebuilds the array)
- **WHEN** a later `tool_execution_update` for "t1" is inserted
- **THEN** the stale index entry SHALL resolve to nothing and the insert SHALL
  proceed as a no-op collapse
- **AND** no other event SHALL be removed — in particular the buffer's highest-seq
  event SHALL still be present and `getMaxSeq(sessionId)` SHALL be unchanged by
  the collapse step

#### Scenario: The newest event in the buffer is never collapsed away

- **GIVEN** a buffer whose highest-seq event is a `tool_execution_update`
- **WHEN** collapse runs
- **THEN** `getMaxSeq(sessionId)` SHALL return that event's seq, unchanged

#### Scenario: Inserted event is readable by its returned seq

- **WHEN** `insertEvent` returns `seq` for a `tool_execution_update` that
  superseded an earlier one
- **THEN** `getEvent(sessionId, seq)` SHALL return that event, so the broadcast
  path re-reads it successfully

#### Scenario: Collapse does not scan the whole buffer per insert

- **GIVEN** a session buffer already holding a large tail of NON-update events
- **WHEN** many subsuming `tool_execution_update` events are inserted,
  INTERLEAVED across many distinct `toolCallId`s so the buffer length stays large
- **THEN** the buffer SHALL hold at most the creating and newest update per
  `toolCallId` at every observable point
- **AND** the total collapse work SHALL NOT be proportional to
  `events × buffer length`
- **AND** the lookup SHALL NOT be a forward linear scan from the head of the
  buffer — a single-`toolCallId` fixture keeps the buffer short and CANNOT
  detect this, so it does not satisfy this scenario

#### Scenario: A pinned creating update is not collapsed when it is also the newest

- **GIVEN** a `toolCallId` whose only retained update is the entry-creating one
- **WHEN** a subsuming `tool_execution_update` for that `toolCallId` is inserted
- **THEN** the creating update SHALL still be retained
- **AND** the newly inserted update SHALL also be retained

#### Scenario: The collapse index does not outlive its session buffer

- **GIVEN** sessions whose buffers are removed by LRU eviction and by
  `deleteEventsForSession`
- **WHEN** many such sessions are cycled through the store
- **THEN** the per-session collapse index SHALL be released with each buffer, so
  it SHALL NOT retain an entry per `toolCallId` of every evicted session
- **AND** a session re-ingested after eviction SHALL NOT act on any index entry
  left over from its previous residency

#### Scenario: Non-update event types are unaffected

- **GIVEN** a buffer containing `message_start`, `message_end`,
  `tool_execution_start` and `tool_execution_end` events
- **WHEN** collapse runs
- **THEN** none of those events SHALL be dropped by the collapse policy

#### Scenario: The essential chat head still survives with collapse enabled

- **GIVEN** a session whose first stored events are `message_start` and
  `message_end`
- **WHEN** a subagent flood of `tool_execution_update` events is inserted with
  collapse enabled and the buffer is driven past the per-session cap
- **THEN** the essential head SHALL still be present and the buffer length SHALL
  still be bounded by `cap + TRIM_SLACK`

### Requirement: Collapse instrumentation

The in-memory event store SHALL make the collapse path observable. `getTrimStats()`
SHALL expose a cumulative process-lifetime count of `tool_execution_update`
events dropped by collapse, alongside the existing trim and eviction counters.
The counter SHALL NOT reset on read.

`getTrimStats()` is serialized onto the `/api/health` response as `storeTrim`.
The new counter SHALL be an ADDITIVE field: no existing field of that payload
changes name, type, or meaning.

The health route's declaration of the store-stats shape SHALL be DERIVED from the
store's exported stats type rather than restated inline, so the route cannot
typecheck against a stale shape when the stats payload gains a field.

#### Scenario: Collapsed updates are counted

- **WHEN** N superseded `tool_execution_update` events are dropped by collapse
- **THEN** `getTrimStats()` SHALL report a cumulative collapsed count of N

#### Scenario: Non-subsuming ticks are not counted as collapsed

- **WHEN** an update is retained because it does not subsume its predecessor
- **THEN** the collapsed count SHALL NOT increment

#### Scenario: Counter is independent of trim and eviction counters

- **WHEN** collapse drops an update AND a per-session trim drops a different
  event
- **THEN** the collapsed count and the trimmed count SHALL each reflect only
  their own policy

#### Scenario: The health payload carries the new counter additively

- **WHEN** `/api/health` is requested
- **THEN** `storeTrim` SHALL include the collapsed counter
- **AND** every previously present `storeTrim` field SHALL still be present with
  its original name and type

### Requirement: A collapsed buffer yields a transmissible catch-up replay frame

The catch-up `event_replay` frame built from a collapsed session buffer SHALL
serialize below `MAX_WS_BUFFER` for a buffer whose superseded
`tool_execution_update` events have been collapsed.

Collapse reduces the buffer that the reconnect catch-up path reads
(`clearReplaying` → `getEvents(sessionId, lastReplayedSeq + 1)` → a single
`event_replay` frame). That reduction is a CONSEQUENCE of the retention policy,
not a transport mechanism, and this requirement exists so the consequence is
asserted rather than assumed — an unasserted side effect regresses silently.

This requirement does NOT introduce a byte budget on the transport. Bounding the
frame by construction (chunking the catch-up tail, measuring serialized frame
bytes at send) is a separate transport change; see design D9.

#### Scenario: The catch-up frame for a collapsed buffer fits the socket budget

- **WHEN** a session buffer has received many superseded `tool_execution_update`
  events across a small number of `toolCallId`s
- **AND** a subscriber reconnects such that the catch-up tail is built from that
  buffer
- **THEN** the serialized `event_replay` frame SHALL be smaller than
  `MAX_WS_BUFFER`

#### Scenario: The same fixture exceeds the budget without collapse

- **WHEN** the identical event sequence is retained with collapse disabled
- **THEN** the serialized catch-up frame SHALL exceed `MAX_WS_BUFFER`
- **AND** this scenario SHALL fail if collapse is made a no-op — a frame-size
  assertion that passes in both configurations proves nothing

#### Scenario: Collapse does not alter which events the catch-up tail selects

- **WHEN** the catch-up tail is built after collapse
- **THEN** it SHALL contain every event with `seq > lastReplayedSeq` that the
  buffer still retains
- **AND** the newest update per `toolCallId` SHALL be among them
