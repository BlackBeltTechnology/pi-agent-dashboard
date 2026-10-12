## MODIFIED Requirements

### Requirement: Structured partialResult handling in event reducer
The event reducer SHALL detect when `tool_execution_update.partialResult` is an object (not a string). When it is an object, it SHALL extract `details` into a `toolDetails` field on the `ChatMessage`, and use `content[0].text` (or JSON.stringify of `content`) as the `result` string.

Exception: when the target row is an `Agent` row that is no longer running, and either the client knows that row's subagent has completed or failed or the row was finalized by the turn settle, the update SHALL still replace `toolDetails` from the update's `details`. It SHALL then keep the row's prior terminal `toolDetails.status`, heal marker, error and missing-result flag, and its prior `result`.

#### Scenario: Agent tool streams structured partialResult
- **WHEN** a `tool_execution_update` event arrives with `partialResult` as an object `{ content, details }` for a running row
- **THEN** the corresponding `ChatMessage` SHALL have `toolDetails` set to the `details` object and `result` set to the text content

#### Scenario: Non-agent tool streams string partialResult
- **WHEN** a `tool_execution_update` event arrives with `partialResult` as a string
- **THEN** the behavior SHALL be unchanged — `result` is set to the truncated string, `toolDetails` remains undefined

#### Scenario: Structured update for a finished subagent keeps the terminal card
- **GIVEN** an `Agent` row that is complete and whose subagent the client recorded as completed
- **WHEN** a `tool_execution_update` with `details.status: "running"` arrives for that call
- **THEN** the row's `toolDetails.status` stays `completed` and its `result` is unchanged
