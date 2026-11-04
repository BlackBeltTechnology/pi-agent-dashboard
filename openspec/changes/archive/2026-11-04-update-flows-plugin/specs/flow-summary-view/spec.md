# Spec Delta

## MODIFIED Requirements

### Requirement: Post-flow summary renders preserved agent cards

When a flow completes and `FlowSummary` mounts, it SHALL render the preserved agent cards (`FlowAgentCard`) from the agents in the flows plugin's own per-session flow slice in a grid layout, frozen and read-only, above the summary lines. The cards SHALL reflect the final state captured at flow completion and SHALL NOT update afterward. The cards SHALL retain their detail-popout (eye) and view-source affordances, so `FlowSummary` SHALL receive the `session` and `sessionId` needed to build them.

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
