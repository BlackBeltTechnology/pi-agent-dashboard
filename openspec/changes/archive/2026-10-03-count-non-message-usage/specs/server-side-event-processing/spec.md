## MODIFIED Requirements

### Requirement: Server-side stats extraction from forwarded turn_end events
The server SHALL extract token/cost stats from `event_forward` messages with `eventType: "turn_end"`. It SHALL call `extractTurnStats()` (from `src/shared/stats-extractor.ts`) with the event data. It SHALL likewise extract usage from a forwarded `message_end` whose `message.role` is `"toolResult"` and from a forwarded `usage_recorded` event (see `token-stats-pipeline`).

When stats are extracted, the server SHALL:
1. Accumulate stats into the session (add to `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`; update `contextTokens`, `contextWindow` only for `turn_end`)
2. Broadcast `session_updated` with the accumulated totals to browsers
3. Synthesize a `stats_update` DashboardEvent and insert it into the event store (for client replay compatibility); a non-`turn_end` source marks it with its usage kind
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

#### Scenario: Non-turn usage synthesizes a kind-marked event
- **WHEN** usage is extracted from a tool-result `message_end` or a `usage_recorded` event
- **THEN** the synthesized `stats_update` SHALL carry its usage kind and no `contextUsage`
