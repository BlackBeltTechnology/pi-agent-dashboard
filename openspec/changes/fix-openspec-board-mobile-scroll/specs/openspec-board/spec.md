## MODIFIED Requirements

### Requirement: Responsive column layout
The board SHALL adapt to viewport width: horizontal scrolling columns on desktop, columns wrapping to multiple rows on tablet widths, and full-width stacked columns on phone widths. At tablet and phone widths the column area SHALL be vertically scrollable so all stacked/wrapped columns and their cards remain reachable within the fixed-height mobile shell.

#### Scenario: Desktop kanban
- **WHEN** the viewport is wider than 900px
- **THEN** columns SHALL lay out horizontally with horizontal scroll

#### Scenario: Tablet wrap
- **WHEN** the viewport is 540–900px
- **THEN** columns SHALL wrap to multiple rows with no horizontal scroll
- **AND** the column area SHALL scroll vertically when the wrapped columns exceed the viewport height

#### Scenario: Phone stack
- **WHEN** the viewport is 540px or narrower
- **THEN** columns SHALL stack full-width and the top bar SHALL wrap
- **AND** the column area SHALL scroll vertically to reach the last card while the top bar and filter bar stay fixed
