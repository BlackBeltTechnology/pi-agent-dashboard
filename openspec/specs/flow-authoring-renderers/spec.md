# flow-authoring-renderers Specification

## Purpose
Flows-plugin renders the authoring tools (flow_write, flow_agents) as flow-aware timeline cards in the main session, distinct from the running-flow card grid. Cards read the real tool result contract, draw the shared `FlowGraph` + counts built from tool args through the not-started pipeline (`buildIdleFlowState`, lenient), expose a view-file sub-row, and replay from persisted tool entries. A New/Edit launcher fires the /skill:edit-flow prompt.

## Requirements

### Requirement: Flows plugin claims tool-renderer slots for authoring tools

The flows-plugin manifest SHALL declare `tool-renderer` slot claims for the `flow_write` and `flow_agents` tools so their main-session tool calls render with flow-aware cards instead of the generic tool renderer. Authoring tool calls SHALL render in the chat timeline, NOT in the flow card grid (which is reserved for running-flow lifecycle events).

#### Scenario: Manifest declares both tool-renderer claims
- **WHEN** the plugin loader validates `packages/flows-plugin/package.json`'s `pi-dashboard-plugin.claims`
- **THEN** there SHALL be a `tool-renderer` claim with `toolName: "flow_write"` AND a `tool-renderer` claim with `toolName: "flow_agents"`

#### Scenario: Authoring tool call renders in timeline
- **WHEN** the main session emits a `flow_write` tool call
- **THEN** the flows-plugin tool renderer SHALL render it as a timeline card
- **AND** no flow card grid entry SHALL be created for it

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

### Requirement: View-file sub-row shows tool args

Each authoring card SHALL provide an expandable "view file" sub-row (flow YAML for `flow_write`, agent markdown for `flow_agents` write) whose content is the tool ARGS (pre-write, zero latency), not a disk fetch.

#### Scenario: Expand shows submitted content
- **WHEN** the user expands the "view file" sub-row on a `flow_write` card
- **THEN** the sub-row SHALL display the exact `content` arg that was submitted

### Requirement: New/Edit launcher issues the edit-flow skill prompt

The flows subcard SHALL offer a New/Edit launcher dialog that builds the prompt `/skill:edit-flow [name]` and fires the shared `onSendPrompt` prop, mirroring the OpenSpec action buttons. The launcher SHALL NOT invoke `flow_write`/`flow_agents` directly. An empty name SHALL produce `/skill:edit-flow`.

#### Scenario: Launch with a selected flow name
- **WHEN** the user picks flow `invoice-research` in the launcher and approves
- **THEN** the plugin SHALL call `onSendPrompt("/skill:edit-flow invoice-research")`

#### Scenario: Launch with no name
- **WHEN** the user approves the launcher with no flow selected
- **THEN** the plugin SHALL call `onSendPrompt("/skill:edit-flow")`

### Requirement: Authoring cards reconstruct from persisted tool entries on replay
Authoring cards are main-session tool calls (not flow-run events); they persist and replay through pi's ordinary session-entry replay, not the `flow-event` stream. The renderer SHALL reconstruct the card — including the flow graph, step/agent counts, and the "view file" sub-row — from the persisted tool input (args) and tool result, so a reloaded session renders the same card without a live tool execution.

#### Scenario: flow_write card replays from persisted entry
- **WHEN** a session reloads and a persisted `flow_write` tool call + result is replayed
- **THEN** the tool renderer SHALL rebuild the success/error state from the persisted result and the flow graph + counts from the persisted args

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

### Requirement: flow_write card renders the shared flow graph built from tool args
On a successful `flow_write`, the card SHALL render the flow graph (with expand-to-full-size) and step/agent/code counts from the `content` arg. It SHALL use Open flow's not-started pipeline, parsing leniently, and the flow panel's graph component and edge-visibility rules, including the error-route toggle. For YAML the panel accepts, under the same error-route toggle state, nodes and edges SHALL equal the panel's. Only a successful write draws a graph.

#### Scenario: Graph derived from args
- **WHEN** a `flow_write` call succeeds with YAML in its `content` arg containing 3 steps (2 agents, 1 code)
- **THEN** the card SHALL display "3 steps · 2 agents, 1 code"
- **AND** SHALL render the flow graph of those 3 steps

#### Scenario: Card graph matches the flow panel
- **GIVEN** a flow YAML with a decision step, an `on_error` route, and a separator step
- **WHEN** it is written with `flow_write` and the same YAML is opened in the flow panel
- **THEN** the card graph and the panel graph SHALL contain the same nodes and the same edges

#### Scenario: Object-form branches draw their edges
- **GIVEN** a decision step whose branches use the object form (`{ to, means }` or `{ to, for_each }`)
- **WHEN** the YAML is shown on a `flow_write` card or opened in the flow panel
- **THEN** each branch SHALL draw an edge to its `to` target

#### Scenario: Card tolerates YAML the strict parser would reject
- **GIVEN** a persisted `flow_write` whose YAML has no top-level `description` and a step with no `type`
- **WHEN** the card renders on replay
- **THEN** it SHALL still render the flow graph and counts, treating the untyped step as an agent step

#### Scenario: Invalid steps are skipped
- **GIVEN** a `flow_write` YAML with three steps, one of which has no `id`
- **WHEN** the card renders
- **THEN** it SHALL draw the two valid steps and display "2 steps"

#### Scenario: Unbuildable args degrade gracefully
- **WHEN** the args are not YAML, or have no step object with an `id` (including `steps: []`)
- **THEN** the card SHALL still show the success state and command
- **AND** SHALL omit the graph and counts without erroring

#### Scenario: No Mermaid output
- **WHEN** a `flow_write` card renders a graph
- **THEN** it SHALL NOT render a Mermaid code block
