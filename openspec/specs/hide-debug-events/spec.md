# hide-debug-events Specification

## Purpose

Keeps debug-level events and debug tool calls out of the chat view by default, so an ordinary session reads as a conversation rather than a trace, with a Settings toggle for when the detail is wanted.

## Requirements

### Requirement: Debug events are hidden by default
The ChatView SHALL NOT render `rawEvent` role messages (e.g., `tool_call`, `tool_result`, `turn_start`) when the debug events toggle is off.

#### Scenario: Raw events hidden by default
- **WHEN** a session emits `tool_call`, `tool_result`, or `turn_start` events
- **AND** the "Show debug events" toggle is off (default)
- **THEN** the orange raw event cards SHALL NOT appear in the chat stream

#### Scenario: Raw events visible when enabled
- **WHEN** the "Show debug events" toggle is on
- **THEN** all `rawEvent` role messages SHALL render as orange `RawEventCard` components

### Requirement: Debug tool calls are hidden by default
The ChatView SHALL NOT render `toolResult` messages for tool names in the debug set (`flow:list-flows`, `flow:rediscover`, `resources_discover`) when the debug events toggle is off.

#### Scenario: Debug tool calls hidden by default
- **WHEN** a `flow:list-flows` or `resources_discover` tool execution completes
- **AND** the "Show debug events" toggle is off (default)
- **THEN** the tool call step SHALL NOT appear in the chat stream

#### Scenario: Debug tool calls visible when enabled
- **WHEN** the "Show debug events" toggle is on
- **THEN** debug tool call steps SHALL render normally as `ToolCallStep` components

### Requirement: Debug events toggle in Settings
The Settings panel Advanced tab SHALL include a "Chat Display" section with a toggle to show or hide debug events.

#### Scenario: Toggle persists across page loads
- **WHEN** the user enables the "Show debug events" toggle
- **AND** reloads the page
- **THEN** the toggle SHALL remain enabled (persisted in localStorage)

#### Scenario: Toggle defaults to off
- **WHEN** the user has never changed the setting
- **THEN** the toggle SHALL be off and debug events SHALL be hidden
