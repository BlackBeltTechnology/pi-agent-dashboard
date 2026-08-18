# server-side-event-processing Specification

## Purpose

Moves work off the bridge and onto the server by deriving state from forwarded events server-side: OpenSpec activity detection and stats extraction from `turn_end` events. Defines where the shared utilities live so bridge and server cannot drift into two implementations.

## Requirements

### Requirement: Server-side OpenSpec activity detection from forwarded events
The server SHALL detect OpenSpec activity by inspecting `event_forward` messages with `eventType: "tool_execution_start"`. It SHALL call `detectOpenSpecActivity()` (from `src/shared/openspec-activity-detector.ts`) with the event's `toolName` and `args` data fields.

When activity is detected, the server SHALL update the session's `openspecPhase` and/or `openspecChange` fields via `sessionManager.update()` and broadcast `session_updated` to browsers. The existing auto-attach logic (attaching a proposal when phase + changeName are both set) SHALL be preserved.

When an `agent_end` event is received, the server SHALL clear `openspecPhase` and `openspecChange` on the session.

#### Scenario: Tool execution triggers OpenSpec phase detection
- **WHEN** an `event_forward` with `eventType: "tool_execution_start"` arrives and `detectOpenSpecActivity(toolName, args)` returns a phase
- **THEN** the server SHALL update the session's `openspecPhase` and broadcast `session_updated`

#### Scenario: Tool execution triggers OpenSpec change name detection
- **WHEN** an `event_forward` with `eventType: "tool_execution_start"` arrives and `detectOpenSpecActivity(toolName, args)` returns a changeName
- **THEN** the server SHALL update the session's `openspecChange` and broadcast `session_updated`

#### Scenario: Agent end clears OpenSpec activity
- **WHEN** an `event_forward` with `eventType: "agent_end"` arrives and the session has `openspecPhase` or `openspecChange` set
- **THEN** the server SHALL clear both fields and broadcast `session_updated`

#### Scenario: Auto-attach preserved
- **WHEN** both `openspecPhase` and `openspecChange` are set and no `attachedProposal` exists
- **THEN** the server SHALL auto-attach the proposal and optionally rename the session (same logic as current `openspec_activity_update` handler)

### Requirement: Server-side stats extraction from forwarded turn_end events
The server SHALL extract token/cost stats from `event_forward` messages with `eventType: "turn_end"`. It SHALL call `extractTurnStats()` (from `src/shared/stats-extractor.ts`) with the event data.

When stats are extracted, the server SHALL:
1. Accumulate stats into the session (add to `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`; update `contextTokens`, `contextWindow`)
2. Broadcast `session_updated` with the accumulated totals to browsers
3. Synthesize a `stats_update` DashboardEvent and insert it into the event store (for client replay compatibility)
4. Broadcast the synthesized `stats_update` event to browser subscribers

#### Scenario: Turn end with usage data triggers stats accumulation
- **WHEN** an `event_forward` with `eventType: "turn_end"` arrives and `extractTurnStats()` returns non-null stats
- **THEN** the server SHALL accumulate stats into the session and broadcast updates

#### Scenario: Turn end without usage data is a no-op
- **WHEN** an `event_forward` with `eventType: "turn_end"` arrives and `extractTurnStats()` returns null
- **THEN** the server SHALL not modify session stats

#### Scenario: Synthesized stats_update event stored for replay
- **WHEN** stats are extracted from a `turn_end` event
- **THEN** the server SHALL insert a `stats_update` DashboardEvent into the event store so browser replays include stats

### Requirement: Shared utility location
`openspec-activity-detector.ts` and `stats-extractor.ts` SHALL be located in `src/shared/` so both the server and any future bridge usage can import them.

#### Scenario: Server imports from shared
- **WHEN** the server processes events
- **THEN** it SHALL import `detectOpenSpecActivity` from `../shared/openspec-activity-detector.js` and `extractTurnStats` from `../shared/stats-extractor.js`
