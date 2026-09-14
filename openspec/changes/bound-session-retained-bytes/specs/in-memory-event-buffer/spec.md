## ADDED Requirements

### Requirement: Per-session aggregate serialized-byte budget
The in-memory event store SHALL bound the total serialized size of the events
retained for each session to `maxBytesPerSession` (default 67 108 864 bytes /
64 MiB, constructor-injectable, `0` = unlimited), in addition to the existing
per-event ceiling and per-session event-count cap. The store SHALL record each
retained event's serialized `data` size as measured AFTER per-event truncation
and SHALL maintain the per-session running total incrementally; it SHALL NOT
re-serialize the buffer to learn its size.

When the running total exceeds the budget, the store SHALL reclaim using the
SAME shed policy as the event-count trim: drop the OLDEST non-essential event
first (essential chat events being exactly the set the count trim protects), and
drop essential events only when the essential events alone exceed the budget.
Reclaim SHALL stop as soon as the total is at or under the budget. Trimming
SHALL NOT renumber surviving events.

Reclaim SHALL be hysteretic: the store SHALL allow the total to overshoot the
budget by a `BYTE_TRIM_SLACK` margin (5 % of the budget, at most 4 MiB) and
SHALL reclaim in a single pass only when the total exceeds
`budget + BYTE_TRIM_SLACK`, so the cost is amortized O(1) per insert. The total
SHALL never exceed `budget + BYTE_TRIM_SLACK` after an insert returns.

The running total SHALL be decremented on EVERY path that removes a retained
event — count trim, byte trim, superseded-update collapse, end-triggered tail
drop, `deleteEventsForSession`, and LRU eviction — so that at every observable
point it equals the sum of the recorded sizes of the resident events.

A single event that is itself larger than the budget SHALL still be admitted
(the per-event ceiling, not the budget, bounds one event); the next reclaim
then holds the invariant against the remaining events.

#### Scenario: Near-ceiling flood stays under budget
- **GIVEN** a session with budget 1 MiB, per-event ceiling 256 KiB, and an event-count cap high enough never to fire
- **WHEN** 100 non-essential events of ~200 KiB each are inserted
- **THEN** the resident byte total SHALL be ≤ 1 MiB + `BYTE_TRIM_SLACK` after every insert
- **AND** the dropped events SHALL be the oldest ones

#### Scenario: Chat head survives a byte trim
- **GIVEN** a session whose first two events are `message_start` (seq 1) and `message_end` (seq 2), each ~1 KiB
- **WHEN** large `tool_execution_update` events push the total past the budget
- **THEN** seq 1 and seq 2 SHALL still be present
- **AND** the dropped events SHALL be the oldest non-essential ones

#### Scenario: Budget zero disables the byte bound
- **WHEN** `maxBytesPerSession` is `0`
- **THEN** the store SHALL retain events up to the event-count cap regardless of their total size

#### Scenario: Accounting is exact after every removal path
- **WHEN** events are removed by count trim, by superseded-update collapse, by end-triggered tail drop, and by `deleteEventsForSession` in one test
- **THEN** after each removal the session's recorded byte total SHALL equal the sum of the recorded sizes of the events still returned by `getEvents(sessionId, 0)`

#### Scenario: Bulk history load stays linear
- **WHEN** a session is reopened and every replayed event is inserted through `insertEvent` in a loop under a budget that trims
- **THEN** total byte-trim work SHALL be O(events) amortized, NOT O(events × resident)

#### Scenario: Byte trim leaves a healable gap
- **GIVEN** a browser subscribed with a `lastSeq` inside the range a byte trim removed
- **WHEN** it resubscribes
- **THEN** the server SHALL serve the events above `lastSeq` that remain, exactly as it does after a count trim

### Requirement: Byte-trim instrumentation
`getTrimStats()` SHALL expose a cumulative, never-reset count of bytes released
by byte-triggered trims as an ADDITIVE field `trimmedBytes`, alongside the
existing counters. Events dropped by a byte trim SHALL ALSO be counted in the
existing `trimmedEvents.total`, `trimmedEvents.toolExecutionEnd`, and
`trimmedEvents.bySession` counters, since they are dropped events. `/api/health`
`storeTrim` SHALL carry `trimmedBytes` and every previously present field with
its original name and type.

#### Scenario: Byte trim is counted in both counters
- **WHEN** a byte trim drops N events totalling B bytes
- **THEN** `getTrimStats().trimmedBytes` SHALL increase by B
- **AND** `getTrimStats().trimmedEvents.total` SHALL increase by N

#### Scenario: Count trim does not move the byte counter
- **WHEN** the event-count trim drops events while the byte total is under budget
- **THEN** `trimmedBytes` SHALL NOT change

#### Scenario: The health payload carries the new counter additively
- **WHEN** `/api/health` is requested
- **THEN** `storeTrim` SHALL include `trimmedBytes`
- **AND** every previously present `storeTrim` field SHALL still be present with its original name and type
