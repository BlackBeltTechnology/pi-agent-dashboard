# flow-summary-view delta

## ADDED Requirements

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
