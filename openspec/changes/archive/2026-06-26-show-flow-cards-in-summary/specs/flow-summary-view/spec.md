## ADDED Requirements

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
