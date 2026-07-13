## ADDED Requirements

### Requirement: Reducer tolerates a malformed tool name

`reduceEvent` SHALL NOT throw when a tool-lifecycle event
(`tool_execution_start`, `tool_execution_update`, `tool_execution_end`) carries an
absent or non-string `toolName`. Any path that performs a string operation on the tool
name (e.g. `.toLowerCase()` for the Write/Edit file-change heuristic) SHALL first
coalesce `toolName` to a safe default. The reduced tool-call state SHALL store a stable
fallback name (`"unknown"`) rather than `undefined`, so the tool card renders instead of
crashing. This mirrors the existing `tool_execution_end` default in `state-replay`.

#### Scenario: tool_execution_start with undefined toolName does not throw

- **GIVEN** the initial `SessionState`
- **WHEN** `reduceEvent` processes a `tool_execution_start` event whose `data.toolName`
  is `undefined`
- **THEN** it SHALL NOT throw
- **AND** it SHALL create a `running` tool-call keyed by `toolCallId` with a fallback
  name (`"unknown"`)
- **AND** it SHALL NOT flag `hasFileChanges` (the unknown name is neither `write` nor
  `edit`)

#### Scenario: non-string toolName is coalesced

- **WHEN** `reduceEvent` processes a tool-lifecycle event whose `toolName` is a
  non-string value (e.g. a number or object)
- **THEN** it SHALL NOT throw
- **AND** it SHALL treat the tool name as the fallback default for all string operations

#### Scenario: valid toolName is unaffected

- **WHEN** `reduceEvent` processes a `tool_execution_start` whose `toolName` is
  `"Write"` or `"Edit"`
- **THEN** it SHALL flag `hasFileChanges` exactly as before this change
- **AND** the tool card SHALL render the real tool name
