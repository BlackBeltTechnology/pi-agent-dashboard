## MODIFIED Requirements

### Requirement: Header meta renders only when present

The header meta block (model name, tokens, duration) SHALL render only when the corresponding fields are supplied via `props.meta`. When `meta` is omitted or its fields are absent, no placeholder dashes or "—" SHALL appear.

#### Scenario: No meta supplied

- **WHEN** `MinimalChatView` is called without a `meta` prop
- **THEN** the header SHALL render the title only, with no token/duration/model badge

#### Scenario: Tokens and duration supplied

- **WHEN** `meta = { tokens: { input: 1234, output: 567 }, durationMs: 4500 }` is passed
- **THEN** the header SHALL render `↓1k ↑567 · 4.5s` (formatted via the UI primitive registry's `formatTokens` and `formatDuration`)

#### Scenario: Subtitle path renders below title

- **WHEN** `subtitle="~/.pi/agent/agents/Explore.md"` is passed
- **THEN** the second line of the title block SHALL render the path in monospace muted-tertiary text with `title` attribute set to the same value
