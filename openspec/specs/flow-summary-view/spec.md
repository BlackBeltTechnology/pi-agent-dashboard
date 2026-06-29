# flow-summary-view Specification

## Purpose

Defines the post-flow `FlowSummary` widget: after a flow completes, it renders the preserved (frozen) agent cards above a collapsible section of the FlowGraph + per-agent summary lines, with dismiss and agent-detail navigation.

## Requirements

### Requirement: Flow summary replaces card grid after completion
When a `flow_complete` event is received, the `FlowDashboard` SHALL transition from the live card grid to a summary view showing the flow outcome.

#### Scenario: Successful flow summary
- **WHEN** `flow_complete` arrives with `status: "success"`
- **THEN** the summary SHALL show "✓ <flowName> complete · N agents · duration" with per-agent status lines

#### Scenario: Failed flow summary
- **WHEN** `flow_complete` arrives with `status: "error"`
- **THEN** the summary SHALL show "⚠ <flowName> failed" with the error summary

#### Scenario: Aborted flow summary
- **WHEN** `flow_complete` arrives with `status: "aborted"`
- **THEN** the summary SHALL show "<flowName> aborted"

### Requirement: Summary shows per-agent results
The summary SHALL list each agent with a status icon (✓ complete, ⚠ error/blocked, ○ pending) and file count. Each agent row SHALL be an independent expandable disclosure: collapsed it shows the status icon, label, step-type badge, file count, and a single truncated summary peek; expanded it reveals the full agent summary, the agent's typed outputs, the per-step file list, and the failure outcome where applicable.

#### Scenario: Agent with files
- **WHEN** an agent result has `files` entries
- **THEN** the collapsed summary line SHALL show the file count (e.g., "(3 files)")

#### Scenario: Collapsed row shows truncated peek
- **WHEN** an agent row is collapsed and the agent has summary text
- **THEN** the row SHALL show a leading collapsed chevron and a single truncated line of the summary

#### Scenario: Expanding a row reveals full detail
- **WHEN** the user clicks an agent row that has expandable content
- **THEN** the row SHALL expand to show the full agent summary rendered as markdown, any typed outputs as chips, the per-step file list, and the soft/hard failure outcome line when the agent failed

#### Scenario: Rows without detail are not expandable
- **WHEN** an agent row has no summary, no files, and no typed outputs
- **THEN** the row SHALL NOT show an interactive chevron and SHALL NOT expand

#### Scenario: Failed steps auto-expand
- **WHEN** the summary first renders and an agent has `status: "error"`
- **THEN** that agent's row SHALL render in the expanded state by default

#### Scenario: Per-row expansion is independent
- **WHEN** the user expands or collapses one agent row
- **THEN** the expanded state of other agent rows SHALL be unaffected

### Requirement: Summary is dismissable
The user SHALL be able to dismiss the summary to return to a clean chat view without the flow dashboard.

#### Scenario: Dismiss summary
- **WHEN** the user clicks a dismiss/close button on the summary
- **THEN** the flow dashboard SHALL be removed from the layout

### Requirement: Summary allows navigating to agent detail
Agent names in the summary SHALL be clickable, navigating to the agent detail view.

#### Scenario: Click agent in summary
- **WHEN** the user clicks an agent name in the summary
- **THEN** the content area SHALL show `FlowAgentDetail` for that agent

### Requirement: Post-flow summary renders preserved agent cards

When a flow completes and `FlowSummary` mounts, it SHALL render the preserved agent cards (`FlowAgentCard`) from `flowState.agents` in a grid layout, frozen and read-only, above the summary lines. The cards SHALL reflect the final state captured at flow completion and SHALL NOT update afterward. The cards SHALL retain their detail-popout (eye) and view-source affordances, so `FlowSummary` SHALL receive the `session` and `sessionId` needed to build them.

If an agent has no meaningful card content, the agent SHALL still be represented by its summary line (graceful fallback); the widget SHALL NOT throw or render an empty frame. No overflow cap is applied to tall grids.

#### Scenario: Cards shown above summary lines on completion
- **WHEN** a flow with multiple agents completes and `FlowSummary` mounts
- **THEN** each preserved agent card SHALL render in the grid layout
- **AND** the cards SHALL appear above the per-agent summary lines
- **AND** the cards SHALL be static (no further live updates)

#### Scenario: Cards keep their drill-in affordances
- **WHEN** the post-flow cards are rendered and the user opens a card's detail (eye) popover
- **THEN** the per-agent detail (tool history) SHALL be reachable from the summary view

#### Scenario: Missing card falls back to summary line
- **WHEN** `FlowSummary` mounts and one agent has no meaningful card content
- **THEN** the remaining cards SHALL render normally
- **AND** that agent SHALL still appear as its summary line
- **AND** the widget SHALL NOT throw

### Requirement: Summary lines section is collapsible beneath the cards

`FlowSummary` SHALL render the FlowGraph and the per-agent summary lines together as a single collapsible section beneath the cards, defaulting to expanded. Collapsing the section SHALL hide the graph and summary lines while the agent cards remain visible. The existing independent per-agent row expand/collapse SHALL be unaffected.

#### Scenario: Collapse hides summary lines but keeps cards
- **WHEN** the user collapses the summary section
- **THEN** the FlowGraph and per-agent summary lines SHALL be hidden
- **AND** the frozen agent cards SHALL remain visible

#### Scenario: Summary section defaults expanded
- **WHEN** `FlowSummary` first mounts after completion
- **THEN** the summary section SHALL be expanded (graph + summary lines visible)

#### Scenario: Per-row expansion still independent
- **WHEN** the summary section is expanded and the user toggles one agent row
- **THEN** other agent rows' expanded state SHALL be unaffected

### Requirement: Expanded flow graph opens a full-size pan/zoom stage

The `FlowSummary` ⤢ Expand affordance SHALL open the graph in the shell
`ui:dialog` primitive at `size="full"`, rendering a non-`fit` (pan/zoom)
`FlowGraph` that fills the dialog. The expanded view SHALL NOT impose an
inner fixed-height (`70vh`) cap, so the horizontal DAG occupies the wide
stage.

#### Scenario: Expand opens the full-size dialog

- **WHEN** the user clicks the ⤢ Expand control on the flow summary graph
- **THEN** a `Dialog` SHALL open at `size="full"` containing the flow graph

#### Scenario: Expanded graph is interactive

- **WHEN** the expanded graph dialog is open
- **THEN** the `FlowGraph` SHALL render in pan/zoom mode (not `fit`) and fill
  the dialog without an inner fixed-height scroll box

### Requirement: Bidirectional graph⇄card selection highlight

`FlowSummary` SHALL hold a single `selectedStepId`. Selecting a step from
either the graph or a card SHALL highlight the corresponding element on
both surfaces and scroll the counterpart element into view. Selection is
ephemeral UI state (not persisted) and clears on Esc, on re-selecting the
same step, or when the agent set changes.

#### Scenario: Click graph node highlights and scrolls its card

- **WHEN** the user clicks a graph node for step `gate`
- **THEN** that node SHALL render a selected treatment (ring + accent glow)
- **AND** the `gate` card SHALL render its selected treatment and be scrolled
  into view

#### Scenario: Click card highlights and scrolls its node

- **WHEN** the user clicks the `gate` card
- **THEN** that card SHALL render a selected treatment
- **AND** the `gate` graph node SHALL render its selected treatment and be
  scrolled into view

#### Scenario: Selection clears

- **WHEN** a step is selected and the user presses Esc, re-clicks the selected
  node/card, or the flow's agent set changes
- **THEN** `selectedStepId` SHALL clear and no node or card SHALL render the
  selected treatment

#### Scenario: Highlight does not open detail

- **WHEN** the user clicks a node in the expanded full-size graph
- **THEN** the step SHALL be selected (highlight only) and no agent-detail
  dialog SHALL open

### Requirement: Source and flow-YAML drill-ins open in dialogs

The agent-source viewer and the flow-YAML viewer SHALL open their content in the
shell dialog primitive instead of an anchored popover. Both render plain
markdown, so they use the standard padded dialog (not flush), with the title set
to the filename or the flow YAML label.

#### Scenario: Source viewer opens a dialog

- **WHEN** the user clicks the agent-source doc icon on a card
- **THEN** a `Dialog` SHALL open with the agent `.md` rendered as markdown
- **AND** no anchored `Popover` SHALL be used for the source

#### Scenario: Flow-YAML viewer opens a dialog

- **WHEN** the user clicks the flow-YAML doc icon
- **THEN** a `Dialog` SHALL open with the flow YAML rendered in a `yaml` code
  fence
- **AND** no anchored `Popover` SHALL be used for the YAML
