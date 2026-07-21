# event-status-extraction Specification

## Purpose

Pure, side-effect-free extraction of session state updates from forwarded pi events. Given a single dashboard event (or a batch), derive partial session updates — status transitions, current tool name, model/thinking level, accumulated token/cost stats — and classify whether an event marks user-visible activity or demands the user's attention (unread). Fields that must be cleared are set to `null` (not `undefined`) so JSON serialisation does not leave stale values in the browser.

## Requirements

### Requirement: Session status and tool extraction

The system SHALL derive partial session updates from a single event by its `eventType`, returning `null` when the event does not affect session status, tool, or model. When a field must be cleared it SHALL be set to `null` rather than omitted.

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

### Requirement: Model and thinking-level extraction

The system SHALL derive the session's model and thinking level from a `model_select` event, and SHALL ignore the event when the model identity is incomplete.

#### Scenario: Model select with full identity

- **WHEN** a `model_select` event is extracted whose `model` has both `provider` and `id`
- **THEN** the update sets `model` to the string `"<provider>/<id>"`
- **AND** sets `thinkingLevel` from the event when a `thinkingLevel` value is present

#### Scenario: Model select missing provider or id

- **WHEN** a `model_select` event is extracted whose `model` lacks `provider` or `id`
- **THEN** the result is `null` and the model is not updated

### Requirement: Token and cost stats accumulation

The system SHALL accumulate token and cost totals across a batch of events, considering only `stats_update` events, and SHALL return `null` when the batch contains no `stats_update` event.

#### Scenario: Batch with stats updates

- **WHEN** a batch containing one or more `stats_update` events is accumulated
- **THEN** the result sums `tokensIn`, `tokensOut`, and `cost` across those events
- **AND** sums `cacheRead` and `cacheWrite` from each event's `turnUsage`
- **AND** sets `contextTokens` and `contextWindow` from each event's `contextUsage` when present

#### Scenario: Batch without any stats update

- **WHEN** a batch contains no `stats_update` event
- **THEN** the result is `null`

### Requirement: Activity-event classification

The system SHALL classify an event type as user-or-agent activity (used to stamp `lastActivityAt`), returning `true` only for an explicit allowlist and `false` for all other types.

#### Scenario: Allowlisted activity event

- **WHEN** an event type is one of `prompt_send`, `message_start`, `message_end`, `turn_end`, `tool_execution_start`, `tool_execution_end`, `agent_start`, `agent_end`, or `bash_output`
- **THEN** it is classified as activity (`true`)

#### Scenario: Non-allowlisted event

- **WHEN** an event type is not in the activity allowlist
- **THEN** it is classified as non-activity (`false`)

### Requirement: Unread-attention classification

The system SHALL classify whether an event flips a session to unread, based on the before/after status-and-tool snapshot and the event payload, returning `true` only for moments that demand the user's attention and `false` otherwise. The "not currently viewed" gate is the caller's responsibility.

#### Scenario: Turn finished

- **WHEN** the session status transitions from `streaming` to `idle` or from `streaming` to `active`
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Input requested

- **WHEN** `currentTool` becomes `ask_user` and was not previously `ask_user`
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Agent ended with error

- **WHEN** the event type is `agent_end` and its payload has a truthy `error` field
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Ordinary work is not unread

- **WHEN** the event is none of the above (e.g. `message_end`, `tool_execution_*`, `model_select`, or git/process noise)
- **THEN** the event is not an unread trigger (`false`)
