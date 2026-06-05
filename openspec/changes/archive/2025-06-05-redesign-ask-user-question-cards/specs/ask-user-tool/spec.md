## ADDED Requirements

### Requirement: Batch dispatched as a single UI request
The `ask_user` tool SHALL dispatch a `batch` call as a single interactive UI request carrying all sub-questions, rather than as a sequential per-question loop of individual `ctx.ui.*` calls. The tool SHALL issue one request with `method: "batch"` and a `questions[]` array, await a single response containing an index-aligned `answers[]` array, and map that result into the tool's existing text + `details` return shape. Cancellation of the batch SHALL be signalled by the single response and SHALL produce the existing "User cancelled batch …" summary.

#### Scenario: batch issues one request
- **WHEN** the LLM calls `ask_user` with `{method: "batch", questions: [q1, q2, q3]}`
- **THEN** the tool SHALL issue exactly one interactive UI request with `method: "batch"` and `questions: [q1, q2, q3]`
- **THEN** the tool SHALL NOT issue a separate per-question `ctx.ui.*` request for each sub-question

#### Scenario: answers mapped back index-aligned
- **WHEN** the batch response returns `{answers: [a1, a2, a3]}`
- **THEN** the tool's `details.results` SHALL be index-aligned with `questions[]` as `[a1, a2, a3]`
- **THEN** the tool's text summary SHALL list each question with its answer

#### Scenario: multiselect sub-question returns multiple values
- **WHEN** a batch sub-question uses method `multiselect` and the user selects two options
- **THEN** that sub-question's answer SHALL be `{values: [...]}` containing both selected values

#### Scenario: batch cancelled
- **WHEN** the batch response indicates cancellation
- **THEN** the tool SHALL return a "User cancelled batch …" summary consistent with prior behavior

#### Scenario: single-method calls unchanged
- **WHEN** the LLM calls `ask_user` with a non-batch method (`confirm`, `select`, `multiselect`, or `input`)
- **THEN** the tool SHALL dispatch it exactly as before (no `batch` method, no `questions[]` envelope)
