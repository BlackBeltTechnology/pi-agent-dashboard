## MODIFIED Requirements

### Requirement: Stats accumulation
A `stats_update` event SHALL add its token usage to the running totals. Only a turn-kind `stats_update` (no usage kind, or kind `turn`) SHALL append a `TurnStat` entry (capped at 50 entries); non-turn usage (tool, compaction, branch summary, usage entries) SHALL NOT append one, so it neither appears as a chart bar nor evicts real turns. If `contextUsage` is present, it SHALL update the session's context usage.

#### Scenario: Turn stats recorded
- **WHEN** a `stats_update` event with `turnUsage` arrives
- **THEN** a TurnStat SHALL be appended to `turnStats` and totals SHALL be incremented

#### Scenario: Turn stats capped
- **WHEN** `turnStats` exceeds 50 entries
- **THEN** the oldest entry SHALL be removed

#### Scenario: Non-turn usage adds to totals only
- **WHEN** a `stats_update` with usage kind `usage:cache_warm` arrives
- **THEN** the totals SHALL increase
- **AND** `turnStats` SHALL be unchanged
