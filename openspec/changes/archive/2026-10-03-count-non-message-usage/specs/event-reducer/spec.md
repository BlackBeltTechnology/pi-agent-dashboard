## MODIFIED Requirements

### Requirement: Stats accumulation
A `stats_update` event SHALL add its `tokensIn`, `tokensOut`, `cost`, and its `turnUsage` cache-read and cache-write tokens to the running totals, whatever its usage kind. Only a turn-kind `stats_update` (no usage kind, or kind `turn`) carrying `turnUsage` SHALL perform turn bookkeeping: assign a `turnIndex` to the last user message, increment `turnCount`, and append a `TurnStat` entry (capped at 50 entries). Non-turn usage (tool, compaction, branch summary, usage entries) SHALL NOT perform turn bookkeeping, so it neither appears as a chart bar, evicts real turns, nor shifts turn numbering. If `contextUsage` is present, it SHALL update the session's context usage.

#### Scenario: Turn stats recorded
- **WHEN** a `stats_update` event with `turnUsage` and no usage kind arrives
- **THEN** a TurnStat SHALL be appended to `turnStats` and totals SHALL be incremented

#### Scenario: Turn stats capped
- **WHEN** `turnStats` exceeds 50 entries
- **THEN** the oldest entry SHALL be removed

#### Scenario: Non-turn usage adds to totals only
- **WHEN** a `stats_update` with usage kind `usage:cache_warm` and `turnUsage.cacheRead: 50000` arrives
- **THEN** `cacheRead` and the other totals SHALL increase
- **AND** `turnStats`, `turnCount` and every message's `turnIndex` SHALL be unchanged
