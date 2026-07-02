## MODIFIED Requirements

### Requirement: Renderers read the real tool result contract

The renderers SHALL render from the tool's actual result JSON: `flow_write` returns `{ written, name, namespace, command, path, diagnostics[] }`; `flow_agents` `op:"list"` returns a catalog array and `op:"write"` returns `{ written, name, path, diagnostics[] }`. The renderers SHALL NOT assume the result carries parsed steps, frontmatter, or file content.

The `flow_agents` `op:"list"` card SHALL derive its agent count and names from a NON-truncated source. When the passed `result` string is the display truncation-marker form (matching `«<digits> earlier lines hidden»\n`) or is otherwise not valid JSON, the card SHALL NOT report `0 agents`. It SHALL instead indicate the catalog output was truncated for display and is available via the expand/"show full output" affordance. When a non-truncated structured source is available (the `toolDetails` prop), the card SHALL derive the count from it in preference to parsing the possibly-truncated `result` text.

#### Scenario: flow_write success state
- **WHEN** a `flow_write` result has `written: true`
- **THEN** the card SHALL show the registered command `/<namespace>:<name>` and a success indicator
- **AND** SHALL surface any `diagnostics[]` as non-fatal notes

#### Scenario: flow_write validation failure state
- **WHEN** a `flow_write` result has `written: false` with `diagnostics[]`
- **THEN** the card SHALL render an error state listing each diagnostic verbatim

#### Scenario: flow_agents list renders the catalog
- **WHEN** a `flow_agents` `op:"list"` result returns a valid catalog array of N agents
- **THEN** the card SHALL render the agent names and the count "N agents"

#### Scenario: flow_agents list with a display-truncated result does not report zero
- **WHEN** a `flow_agents` `op:"list"` result string is the truncation-marker form (begins with `«<digits> earlier lines hidden»\n`) and no `toolDetails` count is available
- **THEN** the card SHALL NOT render "0 agents"
- **AND** SHALL indicate the catalog output was truncated and is available via the expand affordance

#### Scenario: flow_agents list derives count from toolDetails when present
- **WHEN** a `flow_agents` `op:"list"` call provides a `toolDetails` object carrying the agent count/names AND the `result` text is truncated or unparseable
- **THEN** the card SHALL render the count and names from `toolDetails`
- **AND** SHALL NOT fall back to reporting "0 agents"
