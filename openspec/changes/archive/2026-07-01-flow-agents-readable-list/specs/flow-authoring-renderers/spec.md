## MODIFIED Requirements

### Requirement: Renderers read the real tool result contract

The renderers SHALL render from the tool's actual result JSON: `flow_write` returns `{ written, name, namespace, command, path, diagnostics[] }`; `flow_agents` `op:"list"` returns a catalog array and `op:"write"` returns `{ written, name, path, diagnostics[] }`. The renderers SHALL NOT assume the result carries parsed steps, frontmatter, or file content.

The `flow_agents` `op:"list"` card SHALL derive its catalog from a NON-truncated source, in this order: (1) the structured `toolDetails` catalog when present; (2) valid-JSON parse of the `result` text; (3) when `result` is the display truncation-marker form (matching `«<digits> earlier lines hidden»\n`) and no `toolDetails` is available, the card SHALL indicate the output was truncated and expandable rather than report `0 agents`; (4) a genuine empty array renders `0 agents`.

When a `toolDetails` catalog is available, the card SHALL render an always-visible per-agent list WITHOUT requiring the host "Show full output" affordance.

#### Scenario: flow_write success state
- **WHEN** a `flow_write` result has `written: true`
- **THEN** the card SHALL show the registered command `/<namespace>:<name>` and a success indicator
- **AND** SHALL surface any `diagnostics[]` as non-fatal notes

#### Scenario: flow_write validation failure state
- **WHEN** a `flow_write` result has `written: false` with `diagnostics[]`
- **THEN** the card SHALL render an error state listing each diagnostic verbatim

#### Scenario: flow_agents list renders the catalog
- **WHEN** a `flow_agents` `op:"list"` result returns a valid catalog array of N agents
- **THEN** the card SHALL render the count "N agents"

#### Scenario: flow_agents list with a display-truncated result does not report zero
- **WHEN** a `flow_agents` `op:"list"` result string is the truncation-marker form and no `toolDetails` is available
- **THEN** the card SHALL NOT render "0 agents"
- **AND** SHALL indicate the catalog output was truncated and available via the expand affordance

#### Scenario: flow_agents list derives count from toolDetails when present
- **WHEN** a `flow_agents` `op:"list"` call provides a `toolDetails` catalog AND the `result` text is truncated or unparseable
- **THEN** the card SHALL render the count and per-agent rows from `toolDetails`
- **AND** SHALL NOT fall back to reporting "0 agents"

## ADDED Requirements

### Requirement: flow_agents list renders an expandable per-agent list

When the `flow_agents` `op:"list"` card has a catalog (from `toolDetails` or a parsed text result), it SHALL render one row per agent. Each row SHALL show the agent `name`, its `description`, and a `source_type` badge (`local` / `package` / `built-in`). Rows SHALL be present WITHOUT requiring the host "Show full output" affordance when a `toolDetails` catalog is available. Rows SHALL be individually expandable to reveal the agent's `tools`, `inputs`, `outputs`, and `use_when` when those fields are present; fields that are absent SHALL be omitted from the expanded block. Rows SHALL render collapsed by default.

#### Scenario: List renders one row per agent with name, description, source badge
- **WHEN** the card has a catalog of agents where each has `name`, `description`, and `source_type`
- **THEN** the card SHALL render one row per agent showing the name, the description, and a badge for its `source_type`

#### Scenario: A row expands to reveal agent detail fields
- **WHEN** the user expands an agent row whose catalog entry has `tools`, `inputs`, `outputs`, and/or `use_when`
- **THEN** the row SHALL reveal a detail block listing each present field
- **AND** SHALL omit any field that is absent from the catalog entry

#### Scenario: Rows are visible without Show full output when details are present
- **WHEN** a `toolDetails` catalog of N agents is available (even if the text `result` is truncated)
- **THEN** the N per-agent rows SHALL render directly in the card
- **AND** the user SHALL NOT need to trigger "Show full output" to see them

#### Scenario: Rows collapsed by default
- **WHEN** the list card first renders
- **THEN** every agent row SHALL be collapsed
- **AND** no per-agent detail block SHALL be shown until the user expands a row
