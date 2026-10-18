## MODIFIED Requirements

### Requirement: Row 1 carries an active-YOLO indicator

While a YOLO session is active, the sidebar header's app-level control row
SHALL be visibly tinted. The tint is the row-1 YOLO indicator: it SHALL NOT add a
visible control, SHALL NOT displace or replace any row-1 control, and SHALL NOT
name the remaining time
(the remaining time is named on the prompt composer and the Access page).

The tint SHALL be conditional: with no YOLO session active, row 1 SHALL render
exactly as it does today.

While tinted, row 1 SHALL carry the full YOLO description as its pointer
tooltip (row-1 controls with their own tooltip keep it); SHALL contain, as its first focusable element, a link to the surface
where the session can be ended that is visually hidden until it receives
keyboard focus and whose accessible name is the full description. Row 1 itself
SHALL NOT navigate on click. The tint SHALL NOT be dismissible.

At viewport widths of 375 px (with the sidebar drawer opened), 768 px and
1500 px, each at a viewport height of at least 600 px, with the interface
language set to `en` and to `hu`, scoped or unscoped, row 1's height with the
tint SHALL equal its height with no YOLO session active, including while the
YOLO link holds keyboard focus.

In every named theme in light and dark mode, while tinted, row 1's secondary and
tertiary text SHALL each have a contrast against the tint of at least 4.5:1 or
of at least 85% of its contrast against the untinted row background, and the
tint's underline SHALL have a contrast of at least 3:1 against the tint. The tint's visual
boundary SHALL NOT be drawn with a border that adds to the row's box. This
requirement does not constrain how the other row-1 controls render when row 1
runs out of width.

#### Scenario: The indicator is absent by default

- **WHEN** the sidebar header renders and no YOLO session is active
- **THEN** row 1 SHALL contain exactly the controls it contains today, with no tint, no YOLO tooltip and no YOLO link

#### Scenario: The indicator appears while YOLO is active

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL be tinted
- **AND** it SHALL contain exactly the same visible controls as with no YOLO session active
- **AND** hovering row 1 outside its controls that have their own tooltip SHALL show the full YOLO description

#### Scenario: The tint does not change row 1's height

- **GIVEN** an active YOLO session, scoped or unscoped, and the interface language is `en` or `hu`
- **WHEN** the sidebar header renders at a viewport width of 375 px (sidebar drawer opened), then 768 px, then 1500 px, with a viewport height of at least 600 px
- **THEN** at each width row 1's height SHALL equal its height when no YOLO session is active at that same width

#### Scenario: The row leads to the Access page

- **GIVEN** an active YOLO session
- **WHEN** keyboard focus enters row 1 and Enter is pressed on the now-visible YOLO link
- **THEN** the Access settings page SHALL be shown
- **AND** clicking row 1 anywhere outside that link, including its existing controls, SHALL behave as it does with no YOLO session active

#### Scenario: The tint keeps row 1 legible in every theme

- **GIVEN** an active YOLO session
- **WHEN** row 1 is rendered in each named theme, light and dark
- **THEN** its secondary and tertiary text SHALL each reach 4.5:1 against the tint, or at least 85% of their contrast against the untinted row background
- **AND** the underline SHALL reach 3:1 against the tint

#### Scenario: The indicator is not the only signal

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header is not visible
- **THEN** the operator SHALL still be shown that YOLO is active and the remaining time by the strip on every dashboard prompt composer in scope

### Requirement: Two-row header layout
The sidebar header SHALL render as two distinct rows within a single border-bottom container.

#### Scenario: Row 1 contains app-level controls
- **WHEN** the sidebar header renders
- **THEN** the first row SHALL contain a left-aligned group of π logo, ThemePicker, and ThemeToggle; and a right-aligned group of InstallButton (conditional), TunnelButton, ServerSelector (headerExtra, conditional), and Settings gear icon
- **AND** while a YOLO session is active the row SHALL additionally behave as required by "Row 1 carries an active-YOLO indicator", adding no visible control

#### Scenario: Row 2 contains filter controls
- **WHEN** the sidebar header renders
- **THEN** the second row SHALL contain the folder-filter and session-search inputs and the "Active only" and "Show hidden" toggle buttons
- **AND** the second row SHALL NOT contain a folder Pin+ button (relocated to the scroll list per `dashboard-add-buttons`)

#### Scenario: Row spacing
- **WHEN** both rows render
- **THEN** row 1 SHALL use compact padding and row 2 SHALL use normal padding, with no visible divider between them

### Requirement: Row 1 carries an open-questions pill

The sidebar header's app-level control row SHALL render a compact open-questions
pill while at least one question is open for the user (see
`pending-question-stack`), placed immediately after TunnelButton.
The pill SHALL show a question glyph and the open-question count, SHALL expose an
accessible name stating the count, and SHALL open the question panel. It SHALL
NOT render when no question is open, leaving row 1 exactly as it is today, and it
SHALL NOT displace or replace any existing row-1 control.

#### Scenario: Absent with no open questions

- **WHEN** the sidebar header renders and no question is open
- **THEN** row 1 SHALL contain exactly the controls it contains today

#### Scenario: Present with open questions

- **GIVEN** three open questions
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL additionally contain the pill showing 3 with accessible name "3 open questions"
- **AND** every existing row-1 control SHALL still be present
- **AND** the pill SHALL be placed immediately after TunnelButton whether or not a YOLO session is active
