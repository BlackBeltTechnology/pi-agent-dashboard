## Purpose

Session-card context-usage gradient bar: a compact horizontal indicator of context-window usage, inlined with the activity indicator and cost, with an optional compaction annotation badge.
## Requirements
### Requirement: Context usage gradient bar on session cards
Session cards SHALL display a compact horizontal gradient bar indicating context window usage percentage, inlined on the same row as the activity indicator and cost. The bar SHALL occupy approximately 1/5 of the card width. The cost display SHALL remain.

#### Scenario: Bar is inline with activity and cost
- **WHEN** a session card is rendered (desktop or mobile)
- **THEN** the context usage bar appears on the same row as the activity indicator and cost, between them (activity left, bar middle, cost right)

#### Scenario: Bar reflects context usage percentage
- **WHEN** a session has context usage data (e.g., 60% of context window used)
- **THEN** the card displays a compact gradient bar filled to 60%

#### Scenario: Green zone
- **WHEN** context usage is below 50%
- **THEN** the bar fill color is green

#### Scenario: Yellow zone
- **WHEN** context usage is between 50% and 80%
- **THEN** the bar fill color is yellow

#### Scenario: Red zone
- **WHEN** context usage is above 80%
- **THEN** the bar fill color is red

#### Scenario: No context data available
- **WHEN** a session has no context usage data yet
- **THEN** the bar is shown as empty/gray

#### Scenario: Percentage shown on hover only
- **WHEN** the user hovers over the compact context bar
- **THEN** a tooltip displays the percentage and token counts (e.g., "42% context used (50,000 / 120,000)")

#### Scenario: No percentage text visible
- **WHEN** the compact context bar is rendered
- **THEN** no percentage text label is displayed next to the bar

#### Scenario: Cost remains visible
- **WHEN** a session has cost data
- **THEN** the cost ($X.XX) is still displayed on the session card, to the right of the context bar

### Requirement: Context usage bar shows a compaction badge with reason and token reduction

When session state carries compaction metadata (`reason`, estimated post-compaction tokens — pi 0.79.8/0.79.10+), a small visible badge/pill SHALL render next to the context usage bar showing a reason label and the approximate token reduction, e.g. `auto-threshold −12.4k`. The reason label mapping SHALL be: `manual` → "manual", `threshold` → "auto-threshold", `overflow` → "overflow-retry". The reduction SHALL be shown as abbreviated tokens (pre-compaction − estimated post-compaction). When the metadata is absent NO badge SHALL render and the bar SHALL be identical to today. The label/abbreviation derivation SHALL be a pure function (unit-testable independently of the DOM).

#### Scenario: Auto-threshold compaction renders a visible badge
- **WHEN** session state has `reason:"threshold"` and an estimated post-compaction token count yielding a 12,400-token reduction
- **THEN** a visible badge SHALL render next to the bar with text `auto-threshold −12.4k`

#### Scenario: Reason label mapping (pure function)
- **WHEN** the label deriver is called with `reason` ∈ {`manual`,`threshold`,`overflow`}
- **THEN** it SHALL return {`"manual"`,`"auto-threshold"`,`"overflow-retry"`} respectively

#### Scenario: No metadata renders no badge
- **WHEN** session state has no compaction metadata
- **THEN** no badge SHALL render and the bar DOM SHALL be identical to today

