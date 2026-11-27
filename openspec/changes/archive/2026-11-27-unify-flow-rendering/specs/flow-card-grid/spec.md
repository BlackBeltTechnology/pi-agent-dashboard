# Spec Delta

## MODIFIED Requirements

### Requirement: Mobile collapsed mode
On mobile viewports, the flow dashboard SHALL, for a not-started or running flow, collapse to a thin status bar showing the flow name and agent progress count. Tapping the bar SHALL expand to show the full card grid. A completed flow SHALL render its full completed panel without the bar.

#### Scenario: Mobile shows collapsed bar
- **WHEN** the viewport is mobile-width and a flow is active
- **THEN** the flow dashboard SHALL render as a single-line bar (e.g., "π research-and-build · 2/4 agents") instead of the card grid

#### Scenario: Tap to expand on mobile
- **WHEN** the user taps the collapsed bar on mobile
- **THEN** the full card grid SHALL be displayed

#### Scenario: Desktop shows full grid
- **WHEN** the viewport is desktop-width
- **THEN** the flow dashboard SHALL always render the full card grid

#### Scenario: Completed flow skips the bar on mobile
- **WHEN** the viewport is mobile-width and the shown flow has completed
- **THEN** the flow dashboard SHALL render the completed panel (header, Dismiss, sections) and no collapsed bar
