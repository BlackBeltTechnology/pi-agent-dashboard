# Spec Delta

## MODIFIED Requirements

### Requirement: Debug tool calls are hidden by default
The ChatView SHALL NOT render `toolResult` messages for tool names in the debug set (`resources_discover`) when the debug events toggle is off. The debug set SHALL NOT name any pi-flows tool; pi-flows registers no `flow:list-flows` or `flow:rediscover` tool.

#### Scenario: Debug tool calls hidden by default
- **WHEN** a `resources_discover` tool execution completes
- **AND** the "Show debug events" toggle is off (default)
- **THEN** the tool call step SHALL NOT appear in the chat stream

#### Scenario: Debug tool calls visible when enabled
- **WHEN** the "Show debug events" toggle is on
- **THEN** debug tool call steps SHALL render normally as `ToolCallStep` components

#### Scenario: pi-flows tools are not debug tools
- **WHEN** a `flow_agents` or `flow_results` tool execution completes
- **AND** the "Show debug events" toggle is off
- **THEN** the tool call step SHALL render in the chat stream
