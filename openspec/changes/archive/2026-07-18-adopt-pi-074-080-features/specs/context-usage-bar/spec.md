## ADDED Requirements

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
