## MODIFIED Requirements

### Requirement: Event status extraction
The server SHALL extract session status changes from forwarded events and apply them to the session record:
- `agent_start` → `status: "streaming"`, `currentTool: undefined`
- `agent_end` → `status: "idle"`, `currentTool: undefined`
- `tool_execution_start` without `parentToolCallId` → `currentTool: <toolName>`
- `tool_execution_end` without `parentToolCallId` → `currentTool: undefined`
- `tool_execution_*` with `parentToolCallId` (a nested call) → no change to `currentTool`
- `model_select` → `model: "<provider>/<id>"`, optionally `thinkingLevel`

#### Scenario: Agent starts streaming
- **WHEN** an `agent_start` event is forwarded
- **THEN** the session status SHALL change to `"streaming"`

#### Scenario: Tool execution tracked
- **WHEN** a `tool_execution_start` event with `toolName: "read"` is forwarded
- **THEN** the session's `currentTool` SHALL be set to `"read"`

#### Scenario: Model change detected
- **WHEN** a `model_select` event with `model: { provider: "anthropic", id: "claude-4" }` is forwarded
- **THEN** the session's `model` SHALL be updated to `"anthropic/claude-4"`

#### Scenario: Nested end does not clear the parent
- **WHEN** `currentTool` is `codemode` and a nested `tool_execution_end` carrying `parentToolCallId` arrives
- **THEN** `currentTool` SHALL remain `codemode`
