## MODIFIED Requirements

### Requirement: Completed summary panel collapses to its header

The completed-flow `FlowSummary` SHALL provide a whole-panel collapse control in its header, beside Dismiss, distinct from BOTH the per-agent row disclosure AND the summary-lines section collapse. Activating it SHALL hide the entire panel body (flow graph, frozen agent cards, summary-lines section, and next-step suggestion), leaving only the header bar (flow name, status, step/duration meta, the toggle, and Dismiss). It SHALL default to collapsed (see `flow-panel-collapse-persistence`) and SHALL be reversible. Collapsing SHALL NOT dismiss the panel — the socket/summary remains mounted.

#### Scenario: Collapse shrinks the panel to its header
- **WHEN** the user activates the whole-panel collapse control
- **THEN** the flow graph, frozen agent cards, summary-lines section, and next-step suggestion SHALL be hidden
- **AND** the header (flow name, meta, toggle, Dismiss) SHALL remain visible
- **AND** the summary SHALL NOT be dismissed

#### Scenario: Expand restores the body
- **WHEN** the user activates the control again on a collapsed panel
- **THEN** the full panel body SHALL render again

#### Scenario: Distinct from the footer section collapse
- **WHEN** the panel-level collapse is toggled
- **THEN** it SHALL operate independently of the existing summary-lines section collapse (the footer toggle that hides only the per-agent summary rows while keeping cards)

## ADDED Requirements

### Requirement: Completed summary header offers Run again, Open flow and Edit

The completed-flow summary header SHALL offer, before Dismiss: **Run again** (starts the same flow, through the task dialog when the flow requires a task), **Open flow…** (see `flow-pre-run-attach`) and **Edit…** (the same pencil popover as the dock chip, see `flows-dock-chip`). Run again and Open flow… SHALL be hidden when the session's flow catalog no longer lists any flow. Run again SHALL be hidden when the catalog no longer lists the completed flow. Run again and Open flow… SHALL be disabled with the reason "A flow is running" while any flow in the session runs; when an action is both hidden (by the catalog rule) and disabled, hidden wins. The actions SHALL stay in the header when the panel is collapsed.

#### Scenario: Run the same flow again
- **WHEN** `batch:apply` has failed and the user activates Run again
- **THEN** `batch:apply` SHALL start again in that session

#### Scenario: Open another flow from the summary
- **WHEN** the user activates Open flow… on a completed summary and picks `ship-it`
- **THEN** the flow panel SHALL show `ship-it` as not started in place of the summary

#### Scenario: Visible while collapsed
- **WHEN** the completed summary is collapsed to its header
- **THEN** Run again, Open flow… and Edit… SHALL still be visible

#### Scenario: Flow no longer exists
- **WHEN** the completed flow is no longer in the session's catalog
- **THEN** Run again SHALL NOT be shown

#### Scenario: Disabled while another flow runs
- **WHEN** a completed summary is shown and a flow in the session is running
- **THEN** Run again and Open flow… SHALL be disabled and SHALL say "A flow is running"
