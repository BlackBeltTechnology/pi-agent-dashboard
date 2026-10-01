## ADDED Requirements

### Requirement: Nested-call records survive retention truncation

When a stored event's data carries a `nestedCalls` record (on a tool-result message or a synthesized `tool_execution_end`), generic retention truncation SHALL NOT replace the record's `calls` array with a placeholder string, and SHALL NOT collapse a record below its `id`, `name`, `status` and `durationMs` fields. To stay within the per-event size ceiling, the store SHALL first drop per-record `arguments` (keeping `argumentsBytes`), then drop the oldest records while setting `complete: false`. It SHALL NOT discard the event's other fields because of the record.

#### Scenario: More than twenty nested calls survive
- **WHEN** a tool-result event carries `nestedCalls.calls` with 40 records
- **THEN** after retention the stored event SHALL still carry an array of records with `id`, `name` and `status`

#### Scenario: Oversized record degrades, parent result kept
- **WHEN** an event's `nestedCalls` would push it past the per-event size ceiling
- **THEN** the stored record SHALL drop `arguments`, then the oldest records, and SHALL carry `complete: false`
- **AND** the event's own result SHALL still be present
