## ADDED Requirements

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
