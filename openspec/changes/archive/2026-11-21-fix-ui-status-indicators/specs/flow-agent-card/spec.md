## MODIFIED Requirements

### Requirement: Agent card displays per-agent cost

A `FlowAgentCard` in its complete state SHALL display the accumulated per-agent
USD cost carried by the `flow_agent_complete` event's `result.cost`, rendered in
the stats line next to token usage and duration (e.g. `↓12k ↑3k · $0.0142 · 4.2s`).

The cost segment SHALL be suppressed when `cost` is absent, `undefined`, or `0`,
mirroring how the card already handles zero/absent token and duration values.
When suppressed, the stats line SHALL render exactly as it does today
(`↓in ↑out · duration`) with no leftover separator.

The formatted value SHALL match the pi-flows TUI precision: two decimals when
the amount is `>= 1` (`$1.20`), four decimals when sub-dollar (`$0.0142`).

The per-agent `cost` SHALL originate from `FlowAgentState.cost`, populated by the
`flow_agent_complete` reducer case from `result.cost`; the reducer SHALL store
the value verbatim (no re-computation) and SHALL leave it `undefined` when the
event omits it.

#### Scenario: Cost shows for a completed agent with nonzero cost

- **WHEN** a flow agent card renders in its complete state for a node whose
  `flow_agent_complete` carried `result.cost` greater than `0`
- **THEN** the stats line SHALL include a `$`-prefixed cost segment between the
  token counts and the duration

#### Scenario: Cost hidden when zero

- **WHEN** a completed agent card has `cost` equal to `0`
- **THEN** the stats line SHALL omit the cost segment and render only tokens and
  duration

#### Scenario: Cost hidden when absent

- **WHEN** a completed agent card has no `cost` (connected pi session predates
  pi-flows cost surfacing, so `result.cost` is `undefined`)
- **THEN** the stats line SHALL omit the cost segment without error

#### Scenario: Sub-dollar cost keeps four decimals

- **WHEN** a completed agent card renders a `cost` value below `1`
- **THEN** the displayed amount SHALL show four decimal places (e.g. `$0.0142`)

#### Scenario: Whole-dollar cost keeps two decimals

- **WHEN** a completed agent card renders a `cost` value at or above `1`
- **THEN** the displayed amount SHALL show two decimal places (e.g. `$1.20`)

#### Scenario: Token arrows follow the dashboard convention
- **WHEN** an agent has 12000 input tokens and 3000 output tokens
- **THEN** the stats line SHALL render input with `↓` and output with `↑`, never the reverse
