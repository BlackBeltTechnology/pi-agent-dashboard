# prompt-derived-tool-state

## MODIFIED Requirements

### Requirement: A pending prompt sets the session's ask_user tool state

When a `prompt_request` is received for a session, the system SHALL set that session's `currentTool` to `"ask_user"` unless a non-`ask_user` tool is currently in flight for that session. Because the `prompt_request` handler does not run inside the forwarded-event path, this SHALL be an explicit session-state write in that handler, not a consequence of event extraction.

A notification is not a prompt. A `notify` message SHALL NOT set `currentTool`, and neither SHALL a `prompt_request` whose `prompt.type` is `"notify"` — the legacy shape emitted by bridges published before the notify channel existed. Neither SHALL be entered into the pending-prompt registry, so neither can be re-derived as `"ask_user"` by the pending-prompt fold at the end of a turn.

#### Scenario: Prompt raised while no tool is in flight

- **WHEN** a `prompt_request` arrives for a session whose `currentTool` is `null`
- **THEN** the session's `currentTool` SHALL become `"ask_user"`

#### Scenario: Prompt raised while a real tool is in flight

- **WHEN** a `prompt_request` arrives for a session whose `currentTool` is `"bash"`
- **THEN** the session's `currentTool` SHALL remain `"bash"`

#### Scenario: Prompt raised without an ask_user tool call

- **WHEN** a `prompt_request` arrives for a session that has issued no `ask_user` tool call (a flow- or plugin-raised prompt)
- **THEN** the session's `currentTool` SHALL become `"ask_user"`
- **AND** no gating on the prompt's `placement` SHALL be applied

#### Scenario: Notify does not set the tool state

- **WHEN** a `notify` message arrives for a session whose `currentTool` is `null`
- **THEN** the session's `currentTool` SHALL remain `null`
- **AND** the session SHALL NOT be entered into the pending-prompt registry

#### Scenario: Legacy notify-shaped prompt_request does not set the tool state

- **WHEN** a `prompt_request` whose `prompt.type` is `"notify"` arrives for a session whose `currentTool` is `null`
- **THEN** the session's `currentTool` SHALL remain `null`
- **AND** the session SHALL NOT be entered into the pending-prompt registry

#### Scenario: Notify does not re-arm the tool state at the end of a turn

- **WHEN** a session has received a notification and no genuine prompt
- **AND** a `tool_execution_end` or `agent_end` arrives that would clear `currentTool`
- **THEN** the session's `currentTool` SHALL be cleared to `null`
- **AND** SHALL NOT be folded to `"ask_user"`

#### Scenario: A genuine prompt still re-arms after a turn

- **WHEN** a session has a genuine pending prompt
- **AND** a `tool_execution_end` arrives that would clear `currentTool`
- **THEN** the session's `currentTool` SHALL remain `"ask_user"`
