## MODIFIED Requirements

### Requirement: Row 1 carries an active-YOLO indicator

The sidebar header's app-level control row SHALL render a compact indicator while
a YOLO session is active, alongside the other persistent app-level indicators.

The indicator SHALL be conditional: it SHALL NOT render when no YOLO session is
active, leaving the row exactly as it is today. It SHALL NOT displace or replace
any existing row-1 control.

It SHALL show that YOLO is active and the remaining time, SHALL lead to the
surface where the session can be ended, and SHALL NOT be dismissible.

At viewport widths of 375 px (with the sidebar drawer opened), 768 px and
1500 px, each at a viewport height of at least 600 px, with the interface
language set to `en` and to `hu` (the shipped locale with the longest indicator
strings), scoped or unscoped, the indicator SHALL occupy a single line — its
height SHALL equal one line box of its text plus its vertical padding and
border — SHALL NOT extend past row 1's right edge, and row 1's height SHALL NOT
exceed its height with no YOLO session active. When row 1 is too narrow for the
indicator's preferred width but at least as wide as its marker plus its
remaining time plus its horizontal padding and border, the indicator's
descriptive label SHALL be clipped with an ellipsis while the active-YOLO marker
and the remaining time stay legible; below that width the indicator SHALL still
not extend past row 1's right edge, and marker and time MAY be clipped. This constrains the indicator only: where, and how, the other row-1
controls render when row 1 runs out of width is unchanged by this requirement.

#### Scenario: The indicator is absent by default

- **WHEN** the sidebar header renders and no YOLO session is active
- **THEN** row 1 SHALL contain exactly the controls it contains today

#### Scenario: The indicator appears while YOLO is active

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL additionally contain a compact YOLO indicator showing the remaining time
- **AND** every existing row-1 control SHALL still be present

#### Scenario: An unscoped session does not grow row 1

- **GIVEN** an active YOLO session that is unscoped and the interface language is `en` or `hu`
- **WHEN** the sidebar header renders at a viewport width of 375 px (sidebar drawer opened), then 768 px, then 1500 px, with a viewport height of at least 600 px
- **THEN** at each width the indicator's height SHALL equal one line box of its text plus its vertical padding and border
- **AND** the indicator's right edge SHALL NOT exceed row 1's right edge
- **AND** row 1's height SHALL NOT exceed its height when no YOLO session is active at that same width

#### Scenario: The indicator is not the only signal

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header is not visible
- **THEN** the operator SHALL still be shown that YOLO is active by a session surface in scope
