## ADDED Requirements

### Requirement: Per-session aggregate serialized-byte budget
The in-memory event store SHALL bound the total serialized size of the events
retained for each session to `maxBytesPerSession` (default 33 554 432 bytes /
32 MiB, constructor-injectable, `0` = unlimited), in addition to the existing
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
`budget + BYTE_TRIM_SLACK`, so the cost is amortized O(1) per insert. A reclaim
pass SHALL reclaim down to the budget itself, NOT merely back to the trigger
threshold: stopping at the threshold would re-fire a full pass on nearly every
subsequent insert, making the bound hysteretic in name only. After
`insertEvent` returns, the total SHALL be at or under
`budget + BYTE_TRIM_SLACK` UNLESS the buffer retains exactly one event — the
single-event floor below, which is the ONLY exception to this bound.

The byte bound SHALL be evaluated only when `maxBytesPerSession` is greater
than zero. A budget of `0` means unlimited, and because `BYTE_TRIM_SLACK` of a
zero budget is itself zero, an unguarded comparison would treat every stored
byte as an overflow and empty each session on its first event — the exact
inverse of what `0` requests. This mirrors the guard the event-count trim
already applies to `maxEventsPerSession`.

The running total SHALL be decremented on EVERY path that removes a retained
event — count trim, byte trim, superseded-update collapse, end-triggered tail
drop, `deleteEventsForSession`, and LRU eviction — so that at every observable
point it equals the sum of the recorded sizes of the resident events.

A single event that is itself larger than the budget SHALL still be admitted
(the per-event ceiling, not the budget, bounds one event), and reclaim SHALL
stop when a buffer is down to one retained event regardless of its size. The
store is total: it SHALL NOT refuse an event, because refusing one silently
drops live transcript data. This is why the hysteresis bound above carries its
single-event exception — a budget smaller than one admitted event cannot be
held, and the store SHALL prefer a bounded overshoot to data loss.

The serialized size a stored event is accounted at SHALL be measured with a
FINITE cap in every configuration, including when the per-event ceiling is
disabled, so that measuring one event can never walk an unbounded object graph
synchronously.

A configured budget SHALL be clamped up to a floor proportional to the largest
admissible single event, so that a budget too small to hold a few events cannot
pin every session at the single-event floor. The clamp SHALL NOT apply to `0`,
which is below every floor and means unlimited — clamping it would enable a byte
bound in the one configuration that requested none. The floor SHALL be derived
from the EFFECTIVE per-event ceiling, falling back to the finite measurement cap
when the per-event ceiling is disabled; deriving it from a disabled ceiling
yields a floor of zero precisely in the configuration where single events are
unbounded and the floor is the only protection.

#### Scenario: A budget of zero is not clamped up to the floor
- **GIVEN** `maxBytesPerSession` is `0` and a per-event ceiling is configured
- **WHEN** the store applies its floor clamp
- **THEN** the effective budget SHALL remain `0` (unlimited)

#### Scenario: The floor is meaningful when the per-event ceiling is disabled
- **GIVEN** the per-event ceiling is `0` and a small non-zero `maxBytesPerSession` is configured
- **WHEN** the store applies its floor clamp
- **THEN** the effective budget SHALL be raised above the finite measurement cap rather than left unchanged

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
- **AND** no byte-triggered reclaim SHALL run, even on the first event stored

#### Scenario: A single event larger than the budget is admitted and retained
- **GIVEN** a per-session budget of 1 MiB and a per-event ceiling that admits a 2 MiB event
- **WHEN** that single event is inserted into an empty buffer
- **THEN** the event SHALL be retained
- **AND** reclaim SHALL NOT empty the buffer in an attempt to reach the budget

#### Scenario: Essentials are dropped only when essentials alone exceed the budget
- **GIVEN** a session whose `message_*` events alone exceed `maxBytesPerSession`
- **WHEN** the byte reclaim runs
- **THEN** every non-essential event SHALL be dropped before any essential one
- **AND** essential events SHALL then be dropped oldest-first until the total is within the budget
- **AND** for any session where shedding non-essentials suffices, `message_start` and `message_end` SHALL survive

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

#### Scenario: History backfill degrades gracefully after a byte trim
- **GIVEN** a session whose oldest events were released by a byte reclaim
- **AND** `history_backfill` reads only the in-memory store
- **WHEN** the client requests history older than the oldest retained event
- **THEN** the server SHALL return exactly one `history_backfill_result` carrying the events that remain
- **AND** SHALL signal that no further history is available rather than erroring or hanging
- **AND** the retained scrollback depth MAY be shallower than the event-count cap alone would allow

### Requirement: Global aggregate byte budget across all sessions
The store SHALL bound the SUM of the per-session byte totals across every
resident session buffer to `maxTotalEventBytes` (default 805 306 368 bytes /
768 MiB, constructor-injectable, `0` = unlimited). The per-session budget alone
is insufficient: `maxBytesPerSession × maxCachedSessions` is the true resident
envelope, and with the shipped values that product exceeds the heap ceiling the
server has already died at.

Global reclaim SHALL be hysteretic on the same shape as the per-session bound:
the store SHALL allow the global total to overshoot by a `GLOBAL_TRIM_SLACK`
margin (5 % of the global budget, at most 64 MiB), SHALL run reclaim only when
the total exceeds `budget + GLOBAL_TRIM_SLACK`, and SHALL reclaim down to the
budget itself so that consecutive passes are separated by a full slack window of
inserts. Without this, a store resting at its budget would sort the buffer map
and reclaim on every subsequent insert. The observable ceiling is therefore
`maxTotalEventBytes + GLOBAL_TRIM_SLACK`, not `maxTotalEventBytes`. As with the
per-session bound, global reclaim SHALL be evaluated only when
`maxTotalEventBytes` is greater than zero.

When the global total exceeds that threshold, the store SHALL reclaim by evicting
whole session buffers in least-recently-accessed order, SKIPPING pinned sessions
(the existing `isSessionPinned` predicate) exactly as LRU eviction does today, so
an attached or subscribed session is never evicted to serve an idle one.

If every resident session is pinned and the total still exceeds the threshold,
the store SHALL fall back to per-session byte reclaim against the
least-recently-accessed pinned session rather than exceeding the budget
silently. Because `isSessionPinned` is true for any bridge-connected or
browser-subscribed session, this path is ordinary under load and SHALL be
bounded:

- It SHALL reclaim to `budget - GLOBAL_TRIM_SLACK` rather than to exactly the
  budget, so the next insert does not immediately re-trigger it.
- It SHALL drop only NON-essential events. It SHALL NOT fall through to
  essential chat events, because the session being reclaimed may be within its
  own per-session budget and is being trimmed to serve another session.
- When dropping every non-essential event across pinned sessions still leaves
  the total above the budget, the store SHALL accept the overshoot and record it
  rather than dropping essential events.
- Having accepted an overshoot, the store SHALL NOT repeat the fallback scan on
  every subsequent insert. It SHALL latch the exceeded state and resume
  reclaiming only when something can change the outcome — a buffer is evicted or
  deleted, a session unpins, or the total falls below the budget. Without the
  latch the fallback's precondition stays true forever and the scan runs per
  event, which is the cost the hysteresis exists to prevent.

The exceeded state SHALL be observable as the `storeRetention` latch on
`/api/health`, since it means the configured budget is below what the live
pinned working set requires.

Evicting a whole unpinned buffer SHALL NOT be treated as a violation of chat-head
preservation. Chat-head protection governs what survives WITHIN a retained
buffer; an evicted session is non-resident rather than degraded and rehydrates
from its transcript on reopen, exactly as under the existing count-based LRU.

The global total SHALL be maintained incrementally from the same per-session
totals, decremented on every removal path, and SHALL NOT require a walk of all
buffers.

#### Scenario: Product of per-session budgets exceeds the global budget
- **GIVEN** `maxBytesPerSession` = 32 MiB, `maxCachedSessions` = 32 and `maxTotalEventBytes` = 768 MiB
- **WHEN** 32 unpinned sessions each retain 32 MiB (1024 MiB in total)
- **THEN** the store SHALL evict least-recently-accessed session buffers until the global total is at or under 768 MiB
- **AND** no individual session SHALL have been byte-trimmed, because each is within its per-session budget

#### Scenario: Pinned sessions are not evicted by the global budget
- **GIVEN** the global total exceeds `maxTotalEventBytes`
- **AND** the least-recently-accessed session is pinned
- **WHEN** global reclaim runs
- **THEN** that session SHALL NOT be evicted
- **AND** an unpinned, more-recently-accessed session SHALL be evicted instead

#### Scenario: Global budget zero disables the global bound
- **WHEN** `maxTotalEventBytes` is `0`
- **THEN** no global reclaim SHALL occur and only the per-session budget and count caps apply
- **AND** no session SHALL be evicted on account of bytes, even on the first event stored

#### Scenario: Global reclaim is amortized, not per-insert
- **GIVEN** the global total has just been reclaimed to the budget
- **WHEN** further events are inserted
- **THEN** no further global reclaim SHALL run until the total again exceeds `budget + GLOBAL_TRIM_SLACK`

#### Scenario: All-pinned fallback spares essential events
- **GIVEN** every resident session is pinned and the global total exceeds the threshold
- **WHEN** the fallback reclaims against the least-recently-accessed pinned session
- **THEN** only non-essential events SHALL be dropped
- **AND** that session's `message_start` / `message_end` events SHALL survive
- **AND** when non-essentials alone cannot bring the total under the budget, the store SHALL retain the essentials and record the overshoot

### Requirement: Resident session count is operator-configurable
The store's `maxCachedSessions` limit SHALL be supplied from configuration
rather than left at the constructor default. `server.ts` currently passes
`undefined` for this parameter, hardcoding 100 and making the direct multiplier
on every per-session bound untunable. The default SHALL be 32.

The store's own constructor default and the configuration default SHALL be the
SAME value. They live in different packages (the shared memory-limits module is
browser-safe and cannot import the store), so nothing else keeps them in step,
and a divergence would give every direct `createMemoryEventStore` call site a
different resident bound from the dashboard's.

#### Scenario: Store default and config default agree
- **WHEN** the store's `maxCachedSessions` constructor default is compared with the configured default
- **THEN** the two SHALL be equal

#### Scenario: Configured resident count is honoured
- **GIVEN** `memoryLimits.maxCachedSessions` is 8
- **WHEN** a 9th unpinned session buffer is created
- **THEN** the least-recently-accessed unpinned buffer SHALL be evicted

#### Scenario: Absent configuration uses the new default
- **WHEN** `memoryLimits.maxCachedSessions` is absent from the config
- **THEN** the store SHALL use 32

### Requirement: Retention and heap headroom are observable
`/api/health` SHALL expose the store's current resident byte total and the
process heap ceiling, so an operator can see how close the server is to the
limit it will die at. `heapSizeLimit` is absent today, so no client can compute
headroom at all.

Store-derived retention signals SHALL be grouped in their own `storeRetention`
block: the resident byte total, the EFFECTIVE budgets the store enforces, and
the global-budget-exceeded latch. They SHALL NOT be placed inside `storeTrim`,
which is documented as cumulative counters never reset on read — a gauge, a
configuration constant and a boolean latch all break the invariant that struct
exists to hold. `heapSizeLimit` is process-derived, not store-derived, and SHALL
sit with the existing process gauges (`rss`, `heapUsed`).

The EFFECTIVE budgets SHALL be published because the floor clamp is applied
inside the store rather than in the shared config loader, so a configured value
and the enforced value can differ, and the settings panel would otherwise
display a bound that is not in force.

#### Scenario: Health groups retention signals outside the counter struct
- **WHEN** `/api/health` is requested
- **THEN** the payload SHALL carry a `storeRetention` block holding the resident byte total, the effective budgets, and the global-budget-exceeded latch
- **AND** `storeTrim` SHALL carry none of them and SHALL remain cumulative counters only
- **AND** the heap size limit SHALL be present beside the existing process gauges
- **AND** every previously present health field SHALL still be present with its original name and type

#### Scenario: Effective budget is visible when the floor clamp applies
- **GIVEN** a configured `maxBytesPerSession` below the floor
- **WHEN** `/api/health` is requested
- **THEN** the effective per-session budget reported SHALL be the clamped value the store enforces, not the configured one

### Requirement: Byte-trim instrumentation
`getTrimStats()` SHALL expose a cumulative, never-reset count of bytes released
by byte-triggered trims as an ADDITIVE field `trimmedBytes`, alongside the
existing counters. Attribution SHALL be stated explicitly: a pass the byte bound
triggered (alone or together with the count bound) SHALL add its released bytes;
a pass triggered ONLY by the event-count bound SHALL NOT; whole-buffer eviction
SHALL NOT (it is not a trim); the all-pinned fallback reclaim SHALL, because it
is a byte trim.

Bytes released by whole-buffer eviction SHALL be counted separately as
`evictedBytes`, alongside the existing `evictedSessions` session count. Without
it the largest byte sink this change introduces is invisible in bytes and a fall
in the resident gauge cannot be attributed.

These counters attribute memory PRESSURE; they are NOT a closed byte ledger.
Bytes also leave the store through superseded-update collapse and
`deleteEventsForSession`, which are ordinary lifecycle rather than budget
pressure and are deliberately uncounted. The resident-bytes gauge, not the sum
of the counters, is the source of truth for what is retained. Events dropped by a byte trim SHALL ALSO be counted in the
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
