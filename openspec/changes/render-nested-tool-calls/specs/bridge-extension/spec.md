## ADDED Requirements

### Requirement: Nested tool_call and tool_result events are not forwarded

The bridge SHALL NOT forward `tool_call` or `tool_result` events that carry `parentToolCallId`. The nested call is represented by its `tool_execution_*` events, and pi does not record nested results. Local bridge handlers on `tool_call` (for example subagent fan-out admission) SHALL still run for nested calls.

#### Scenario: Nested tool_result stays local
- **WHEN** pi emits `tool_result` with `parentToolCallId: "call_1"`
- **THEN** no `event_forward` for it SHALL be sent to the server

#### Scenario: Nested Agent call still admitted
- **WHEN** a codemode script starts an `Agent` tool call
- **THEN** subagent fan-out admission SHALL apply to it as to a model-issued call
