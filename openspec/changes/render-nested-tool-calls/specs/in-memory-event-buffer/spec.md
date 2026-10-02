## ADDED Requirements

### Requirement: Nested-call records survive generic truncation

When a stored event's data carries a `nestedCalls` record (`data.nestedCalls` on a synthesized `tool_execution_end`, or `data.message.nestedCalls` on a tool-result message), the generic per-string-field truncation pass SHALL NOT replace the record's `calls` array with the `"[array truncated]"` string and SHALL NOT collapse a record below its `id`, `name`, `status` and `durationMs` fields at the recursion depth limit. Each record SHALL be truncated as its own root (depth counted from the record), so its string fields are still capped by the per-string-field rule and a deep `arguments` sub-tree is still summarized, never returned raw. This exemption is scoped to the generic pass, like the base64-image exemption; it is NOT an exemption from the per-event total-serialized-size ceiling — an event still over the ceiling SHALL be bounded by that requirement unchanged.

#### Scenario: More than twenty nested calls survive
- **WHEN** a tool-result event carries `nestedCalls.calls` with 40 records
- **THEN** after ingest the stored event SHALL still carry an array of 40 records, each with `id`, `name` and `status`

#### Scenario: Not a ceiling exemption
- **WHEN** an event carrying a `nestedCalls` record exceeds the per-event size ceiling
- **THEN** the store SHALL bound it by the existing per-event ceiling rules without throwing
- **AND** the stored event SHALL be within the ceiling
