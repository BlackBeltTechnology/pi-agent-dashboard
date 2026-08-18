# token-stats-pipeline Specification

## Purpose

End-to-end pipeline for extracting, forwarding, accumulating, and displaying per-turn token usage statistics from pi sessions.

## Requirements

### Requirement: Stats extraction from turn_end events
The bridge extension SHALL extract token usage stats from `turn_end` events by reading `event.message.usage`. The extracted data SHALL include: `tokensIn` (input tokens), `tokensOut` (output tokens), `cost` (from `usage.cost.total`), per-turn breakdown (`turnUsage` with input, output, cacheRead, cacheWrite), and optionally `contextUsage` from `ctx.getContextUsage()`.

#### Scenario: Turn ends with usage data
- **WHEN** a `turn_end` event fires with `message.usage` containing token counts
- **THEN** the bridge SHALL extract stats and send a `stats_update` message

#### Scenario: Turn ends without usage data
- **WHEN** a `turn_end` event fires but `message.usage` is undefined
- **THEN** the bridge SHALL NOT send a `stats_update` message

#### Scenario: Context usage included
- **WHEN** `ctx.getContextUsage()` returns `{ tokens: 50000, contextWindow: 200000 }`
- **THEN** the `stats_update` message SHALL include `contextUsage` with those values

### Requirement: Server-side token accumulation
The server SHALL accumulate token stats on the session record. When a `stats_update` message is received from the bridge, the server SHALL add the per-turn values to the session's running totals (`tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`).

#### Scenario: First turn stats received
- **WHEN** a session's first `stats_update` arrives with `tokensIn: 1000, tokensOut: 500, cost: 0.01`
- **THEN** the session record SHALL be updated to `tokensIn: 1000, tokensOut: 500, cost: 0.01`

#### Scenario: Subsequent turn accumulates
- **WHEN** a second `stats_update` arrives with `tokensIn: 2000`
- **THEN** the session's `tokensIn` SHALL be `3000` (1000 + 2000)

### Requirement: Stats broadcast to browsers
After accumulating stats, the server SHALL broadcast the updated session totals to all connected browsers via `session_updated`. Additionally, the raw `stats_update` event SHALL be stored in the event buffer and broadcast as an `event` to subscribers for the token stats bar chart.

#### Scenario: Stats update triggers session update
- **WHEN** a `stats_update` is processed
- **THEN** a `session_updated` message with the new totals SHALL be broadcast to all browsers

#### Scenario: Stats event stored for replay
- **WHEN** a `stats_update` is processed
- **THEN** a `stats_update` event SHALL be inserted into the event store and broadcast to session subscribers

### Requirement: Event status extraction
The server SHALL extract session status changes from forwarded events and apply them to the session record:
- `agent_start` → `status: "streaming"`, `currentTool: undefined`
- `agent_end` → `status: "idle"`, `currentTool: undefined`
- `tool_execution_start` → `currentTool: <toolName>`
- `tool_execution_end` → `currentTool: undefined`
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
