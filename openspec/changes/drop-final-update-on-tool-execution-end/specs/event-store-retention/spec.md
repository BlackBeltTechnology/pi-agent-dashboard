## ADDED Requirements

### Requirement: The retained tail update SHALL be dropped on `tool_execution_end` ONLY when the end event subsumes it

When `tool_execution_end` arrives for a `toolCallId`, the store MAY drop that
call's retained tail `tool_execution_update` — but ONLY when the end event's
`details` subsume the tail's `details` under the SAME superset gate the collapse
already uses. Absent verified subsumption the tail SHALL be retained.

Rationale: updates resolve `details` from `data.partialResult.details`, ends from
top-level `data.details`, and the client reducer treats them as distinct
branches. Equivalence is therefore a claim about a specific producer version, not
a property of the protocol.

#### Scenario: A subsuming end event drops the tail

- **GIVEN** a retained tail `tool_execution_update` for a `toolCallId`
- **WHEN** a `tool_execution_end` arrives whose `details` subsume the tail's
- **THEN** the tail SHALL be dropped
- **AND** `storeTrim.collapsedUpdates` SHALL account for it
- **AND** a replay SHALL fold to the same rendered state as before the drop

#### Scenario: A non-subsuming end event retains the tail

- **GIVEN** a retained tail update carrying a field the end event omits, or
  holding a different JS type for a shared key
- **WHEN** the `tool_execution_end` arrives
- **THEN** the tail SHALL be RETAINED
- **AND** the rendered subagent state SHALL be unchanged by the arrival

#### Scenario: Cross-version equivalence is verified before any drop is enabled

- **GIVEN** more than one `pi-dashboard-subagents` version in the field
- **WHEN** the drop is enabled
- **THEN** subsumption SHALL have been verified for each version, and any version
  failing it SHALL keep the tail rather than be assumed equivalent
