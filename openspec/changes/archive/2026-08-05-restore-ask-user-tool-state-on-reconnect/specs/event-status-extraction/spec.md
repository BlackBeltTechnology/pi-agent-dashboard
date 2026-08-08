# event-status-extraction Specification (delta)

## MODIFIED Requirements

### Requirement: Session status and tool extraction

The system SHALL derive partial session updates from a single event by its `eventType`, returning `null` when the event does not affect session status, tool, or model. When a field must be cleared it SHALL be set to `null` rather than omitted.

Extraction SHALL additionally accept a `hasPendingPrompt` input describing whether the session is currently blocked on a prompt. When that input is `true` and the derived update would otherwise leave `currentTool` empty, the update SHALL set `currentTool` to `"ask_user"` instead. The reconciliation SHALL be part of computing the update — not a correction applied afterwards — so callers comparing the before-update and after-update values observe no transition. A live `tool_execution_start` naming a tool other than `ask_user` SHALL take precedence over the pending-prompt input. The function SHALL remain pure and SHALL NOT read the gateway, the session manager, or any socket.

#### Scenario: Agent starts

- **WHEN** an `agent_start` event is extracted
- **THEN** the update sets `status` to `streaming`
- **AND** clears `currentTool` to `null`

#### Scenario: Agent ends

- **WHEN** an `agent_end` event is extracted
- **THEN** the update sets `status` to `idle`
- **AND** clears `currentTool` to `null`

#### Scenario: Tool execution starts

- **WHEN** a `tool_execution_start` event is extracted
- **THEN** the update sets `currentTool` to the event's `toolName`
- **AND** sets `currentTool` to `null` when `toolName` is absent

#### Scenario: Tool execution ends

- **WHEN** a `tool_execution_end` event is extracted
- **THEN** the update clears `currentTool` to `null`

#### Scenario: Unhandled event type produces no update

- **WHEN** an event of any other type is extracted
- **THEN** the result is `null` and no session fields change

#### Scenario: Agent starts while a prompt is pending

- **WHEN** an `agent_start` event is extracted with `hasPendingPrompt: true`
- **THEN** the update sets `status` to `streaming`
- **AND** sets `currentTool` to `"ask_user"` rather than `null`

#### Scenario: Tool execution ends while a prompt is pending

- **WHEN** a `tool_execution_end` event is extracted with `hasPendingPrompt: true`
- **THEN** the update sets `currentTool` to `"ask_user"` rather than `null`

#### Scenario: Real tool outranks the pending prompt

- **WHEN** a `tool_execution_start` with `toolName: "bash"` is extracted with `hasPendingPrompt: true`
- **THEN** the update sets `currentTool` to `"bash"`

#### Scenario: Reconciliation is inert without a pending prompt

- **WHEN** any event is extracted with `hasPendingPrompt: false`
- **THEN** the update is byte-identical to the update produced before this change
