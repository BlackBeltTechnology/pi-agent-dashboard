## MODIFIED Requirements

### Requirement: Subscribe to all pi core event types
The bridge extension SHALL subscribe to all pi core event types defined in the extension API, with the exception of `context` and `before_provider_request` which are excluded due to payload size.

The full subscription list SHALL include:
- Already handled with enrichment: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_compact`, `model_select`
- New pass-through types: `tool_call`, `tool_result`, `user_bash`, `input`, `before_agent_start`, `resources_discover`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree`, `session_tree`

Forwarding is otherwise 1:1 with subscription, with ONE scoped exception: a
`tool_execution_update` that is a subagent progress tick (`toolName === "Agent"`
carrying `partialResult.details.agentId`) MAY be COALESCED within a configured
window, latest-wins. The exception is admissible only because such a tick is an
idempotent snapshot with a stable key set (latest-supersedes), so a superseded
tick carries no information its successor lacks. It SHALL NOT extend to any
other event type or tool.

#### Scenario: Known enriched events retain special handling
- **WHEN** a `model_select` event fires
- **THEN** the bridge SHALL enrich it with `thinkingLevel` and forward as `event_forward` (server extracts model/thinkingLevel via `extractSessionUpdates`)

#### Scenario: New pass-through events are forwarded
- **WHEN** a `tool_call` event fires from the pi extension runner
- **THEN** the bridge SHALL forward it as an `event_forward` message with `eventType: "tool_call"` and the serialized event data

#### Scenario: Excluded events are not subscribed
- **WHEN** the bridge initializes
- **THEN** it SHALL NOT subscribe to `context` or `before_provider_request` events

#### Scenario: Subagent progress ticks may be coalesced, nothing else may
- **WHEN** subagent progress ticks arrive faster than the configured window
- **THEN** the bridge SHALL forward the latest one per window and MAY drop the superseded ones
- **AND** every other subscribed event type SHALL still be forwarded 1:1
