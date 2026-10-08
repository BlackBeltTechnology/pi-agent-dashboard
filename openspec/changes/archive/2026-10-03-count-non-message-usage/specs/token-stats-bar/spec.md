## MODIFIED Requirements

### Requirement: Turn index on TurnStat and messages
The event reducer SHALL assign a `turnIndex` to both `TurnStat` and user messages for scroll targeting. Only a turn-kind `stats_update` (no usage kind, or kind `turn`) SHALL take part in turn indexing.

#### Scenario: Turn index assignment
- **WHEN** a turn-kind `stats_update` event with `turnUsage` is processed and the last user message has no `turnIndex`
- **THEN** the user message gets `turnIndex = turnCount`, `turnCount` increments, and the `TurnStat` gets the same `turnIndex`

#### Scenario: Tool-only turn
- **WHEN** a turn-kind `stats_update` event is processed but the last user message already has a `turnIndex`
- **THEN** `turnCount` does NOT increment and the `TurnStat` gets `turnIndex = -1`

#### Scenario: Non-turn usage leaves turn indexing alone
- **WHEN** a `stats_update` with usage kind `usage:cache_warm` and `turnUsage` is processed and the last user message has no `turnIndex`
- **THEN** no `turnIndex` is assigned, `turnCount` does NOT increment, and no `TurnStat` is appended

#### Scenario: ChatView data attributes
- **WHEN** ChatView renders a user message with a `turnIndex`
- **THEN** the DOM element has a `data-turn` attribute set to that index
