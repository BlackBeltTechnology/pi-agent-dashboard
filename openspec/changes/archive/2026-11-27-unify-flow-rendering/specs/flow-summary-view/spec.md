# Spec Delta

## ADDED Requirements

### Requirement: Completed panel uses the live panel layout
A completed flow SHALL render in the same flow panel component as an idle or running flow: header, flow graph, flow-YAML button, **Agent cards** section, then the summary-only sections. Graph and Agent cards content SHALL be identical for a flow state shown as running and as completed; only header controls and summary-only sections differ. The completed panel SHALL show the completed run, never another flow tab.

#### Scenario: Same graph and cards before and after completion
- **GIVEN** a flow with a fan-out step `review` of 3 items and a decision step `gate` that chose branch `fix`
- **AND** the panel is expanded and the Agent cards section is open
- **WHEN** the flow panel renders the flow while running and again after `flow_complete`
- **THEN** both renders SHALL show the same graph node and edge set
- **AND** both SHALL show `review` as one fan-out group card holding 3 item cards
- **AND** both SHALL show the chosen route `fix` and a "not taken" chip for each unchosen branch of `gate`

#### Scenario: Node click opens the Agent cards section after completion
- **GIVEN** an expanded completed flow panel whose Agent cards section is collapsed
- **WHEN** the user clicks the graph node for step `build`
- **THEN** the section SHALL open, `build` SHALL be selected, and its card SHALL scroll into view

#### Scenario: Running-only controls are absent after completion
- **WHEN** the panel renders a completed flow
- **THEN** it SHALL NOT show the AUTO toggle, the Abort button, or the flow tab bar
- **AND** it SHALL show the completion status, Dismiss, and the whole-panel collapse control

#### Scenario: Completed panel ignores a manually selected tab
- **GIVEN** two flows ran in the session and the user had manually selected the tab of flow `a`
- **WHEN** flow `b` completes and the panel shows its completed run
- **THEN** the graph and cards SHALL be those of flow `b`

#### Scenario: Pending question stays visible after completion
- **GIVEN** a flow question is still pending when the flow completes
- **WHEN** the completed panel renders, expanded or collapsed
- **THEN** the pending question card SHALL be visible and answerable
- **AND** answered questions SHALL NOT be listed in the completed panel

#### Scenario: Completed panel on mobile
- **WHEN** a completed flow is shown on a mobile viewport
- **THEN** the panel SHALL render the completed header with Dismiss and its sections
- **AND** it SHALL NOT render the running panel's "tap to expand" bar

## MODIFIED Requirements

### Requirement: Summary shows per-agent results
The summary SHALL list each agent that has summary text with a status icon (✓ complete, ⚠ error/blocked, ○ pending) and file count. Each listed agent row SHALL be an independent expandable disclosure: collapsed it shows the status icon, label, step-type badge, file count, and a single truncated summary peek; expanded it reveals the full agent summary, the agent's typed outputs, the per-step file list, and the failure outcome where applicable.

Agents with no summary text SHALL be omitted from the per-agent Summaries list, even when they carry typed outputs or files — those agents remain visible in the Agent cards section and in the flow graph. The `Summaries (N)` count SHALL be the number of listed (summary-bearing) agents, not the total agent count. When no agent has summary text, the entire Summaries subsection (its header, divider, and rows) SHALL NOT render. The Agent cards section is unaffected by this filter and SHALL still show one card per step, a fan-out step as one group card holding one card per item.

#### Scenario: Agent with files
- **WHEN** a listed agent result has `files` entries
- **THEN** the collapsed summary line SHALL show the file count (e.g., "(3 files)")

#### Scenario: Collapsed row shows truncated peek
- **WHEN** an agent row is collapsed and the agent has summary text
- **THEN** the row SHALL show a leading collapsed chevron and a single truncated line of the summary

#### Scenario: Expanding a row reveals full detail
- **WHEN** the user clicks an agent row that has expandable content
- **THEN** the row SHALL expand to show the full agent summary rendered as markdown, any typed outputs as chips, the per-step file list, and the soft/hard failure outcome line when the agent failed

#### Scenario: Agent without summary text is omitted from the list
- **WHEN** an agent has no summary text (regardless of whether it has typed outputs or files)
- **THEN** that agent SHALL NOT appear as a row in the Summaries list
- **AND** it SHALL still appear in the Agent cards section

#### Scenario: Count reflects only listed agents
- **WHEN** the flow has N agents of which M have summary text
- **THEN** the Summaries header SHALL read "Summaries (M)"

#### Scenario: Section hidden when no agent has summary text
- **WHEN** no agent in the flow has summary text
- **THEN** the Summaries subsection (header + divider + rows) SHALL NOT be rendered

#### Scenario: Failed steps auto-expand
- **WHEN** the summary first renders and a listed agent has `status: "error"`
- **THEN** that agent's row SHALL render in the expanded state by default

#### Scenario: Per-row expansion is independent
- **WHEN** the user expands or collapses one agent row
- **THEN** the expanded state of other agent rows SHALL be unaffected

### Requirement: Post-flow summary renders preserved agent cards

When a flow completes, the completed panel SHALL render the preserved agent cards from the agents in the flows plugin's own per-session flow slice inside the **Agent cards** section, using the same step-card rendering as the live panel (fan-out groups, decision routes, skipped pills, state-pill header). The cards SHALL be frozen and read-only. They SHALL reflect the final state captured at flow completion and SHALL NOT update afterward. The cards SHALL retain their detail-popout (eye) and view-source affordances, so the completed panel SHALL receive the `session` and `sessionId` needed to build them.

If an agent has no meaningful card content, the agent SHALL still be represented by its summary line (graceful fallback); the widget SHALL NOT throw or render an empty frame. No overflow cap is applied to tall grids.

#### Scenario: Cards shown above summary lines on completion
- **GIVEN** the Agent cards section is open
- **WHEN** a flow with multiple agents completes and the completed panel mounts
- **THEN** each preserved agent card SHALL render inside the Agent cards section in the grid layout
- **AND** the Agent cards section SHALL appear above the per-agent summary lines
- **AND** the cards SHALL be static (no further live updates)

#### Scenario: Fan-out step renders as a group after completion
- **GIVEN** the Agent cards section is open
- **WHEN** a completed flow has a fan-out step with 3 items
- **THEN** the Agent cards section SHALL render one group card for that step holding 3 item cards
- **AND** the section header SHALL count the group as one step

#### Scenario: Cards keep their drill-in affordances
- **WHEN** the post-flow cards are rendered and the user opens a card's detail (eye) popover
- **THEN** the per-agent detail (tool history) SHALL be reachable from the summary view

#### Scenario: Missing card falls back to summary line
- **WHEN** the completed panel mounts and one agent has no meaningful card content
- **THEN** the remaining cards SHALL render normally
- **AND** that agent SHALL still appear as its summary line
- **AND** the widget SHALL NOT throw

### Requirement: Summary lines section is collapsible beneath the cards

The completed panel SHALL render the per-agent summary lines as a collapsible **Summaries** section beneath the Agent cards section, defaulting to expanded. Collapsing it SHALL hide only the summary lines; the flow graph and the Agent cards section SHALL remain visible. The existing independent per-agent row expand/collapse SHALL be unaffected.

#### Scenario: Collapse hides summary lines but keeps cards
- **WHEN** the user collapses the Summaries section
- **THEN** the per-agent summary lines SHALL be hidden
- **AND** the flow graph and the Agent cards section SHALL remain visible

#### Scenario: Summary section defaults expanded
- **WHEN** the completed panel first mounts after completion
- **THEN** the Summaries section SHALL be expanded (summary lines visible)

#### Scenario: Per-row expansion still independent
- **WHEN** the Summaries section is expanded and the user toggles one agent row
- **THEN** other agent rows' expanded state SHALL be unaffected

### Requirement: Bidirectional graph⇄card selection highlight

The completed panel SHALL hold a single `selectedStepId`, shared with the
live panel's selection behaviour. Selecting a step from either the graph or
a card SHALL highlight the corresponding element on both surfaces and
scroll the counterpart element into view. Selection is ephemeral UI state
(not persisted) and clears on Esc, on re-selecting the same step, when the
selected step no longer exists, or when the shown flow changes.

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
  node/card, the selected step disappears, or the shown flow changes
- **THEN** `selectedStepId` SHALL clear and no node or card SHALL render the
  selected treatment

#### Scenario: Highlight does not open detail

- **WHEN** the user clicks a node in the expanded full-size graph
- **THEN** the step SHALL be selected (highlight only) and no agent-detail
  dialog SHALL open

### Requirement: Expanded flow graph opens a full-size pan/zoom stage

The completed panel's ⤢ Expand affordance SHALL open the graph in the shell
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

### Requirement: Completed summary panel collapses to its header

The completed panel SHALL provide a whole-panel collapse control in its header, distinct from BOTH the per-agent row disclosure AND the summary-lines section collapse. Activating it SHALL hide the entire panel body (flow graph, Agent cards section, summary-lines section, and next-step suggestion), leaving only the header bar (flow name, status, step/duration meta, the toggle, and Dismiss). It SHALL default to collapsed (see `flow-panel-collapse-persistence`) and SHALL be reversible. Collapsing SHALL NOT dismiss the panel — the socket/summary remains mounted.

#### Scenario: Collapse shrinks the panel to its header
- **WHEN** the user activates the whole-panel collapse control
- **THEN** the flow graph, Agent cards section, summary-lines section, and next-step suggestion SHALL be hidden
- **AND** the header (flow name, meta, toggle, Dismiss) SHALL remain visible
- **AND** the summary SHALL NOT be dismissed

#### Scenario: Expand restores the body
- **WHEN** the user activates the control again on a collapsed panel
- **THEN** the full panel body SHALL render again

#### Scenario: Distinct from the footer section collapse
- **WHEN** the panel-level collapse is toggled
- **THEN** it SHALL operate independently of the existing summary-lines section collapse (the footer toggle that hides only the per-agent summary rows while keeping cards)
