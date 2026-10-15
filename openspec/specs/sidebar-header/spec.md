# sidebar-header Specification

## Purpose

Sidebar header renders two rows: app-level controls (logo, theme, install, tunnel, server selector, settings) and filter controls (folder + session search, hidden/active toggles).

## Requirements

### Requirement: Two-row header layout
The sidebar header SHALL render as two distinct rows within a single border-bottom container.

#### Scenario: Row 1 contains app-level controls
- **WHEN** the sidebar header renders
- **THEN** the first row SHALL contain a left-aligned group of π logo, ThemePicker, and ThemeToggle; and a right-aligned group of InstallButton (conditional), TunnelButton, the YOLO indicator (conditional: only while a YOLO session is active, immediately after TunnelButton), ServerSelector (headerExtra, conditional), and Settings gear icon

#### Scenario: Row 2 contains filter controls
- **WHEN** the sidebar header renders
- **THEN** the second row SHALL contain the folder-filter and session-search inputs and the "Active only" and "Show hidden" toggle buttons
- **AND** the second row SHALL NOT contain a folder Pin+ button (relocated to the scroll list per `dashboard-add-buttons`)

#### Scenario: Row spacing
- **WHEN** both rows render
- **THEN** row 1 SHALL use compact padding and row 2 SHALL use normal padding, with no visible divider between them

### Requirement: All existing controls preserved
The header controls SHALL remain present and functional after the layout change, except the folder Pin+ button which relocates to the scroll list.

#### Scenario: No controls removed except Pin+
- **WHEN** the sidebar header renders with all features enabled
- **THEN** all of the following SHALL be present: π logo, ThemePicker, ThemeToggle, "Active only" toggle, "Show hidden" toggle, InstallButton, TunnelButton, headerExtra (ServerSelector), Settings gear
- **AND** the folder Pin+ button SHALL NOT be present in the header

#### Scenario: Conditional controls still conditional
- **WHEN** InstallButton conditions are not met (already installed or not installable)
- **THEN** InstallButton SHALL not render, same as current behavior

### Requirement: Row 1 carries an active-YOLO indicator

The sidebar header's app-level control row SHALL render a compact indicator while
a YOLO session is active, alongside the other persistent app-level indicators.

The indicator SHALL be conditional: it SHALL NOT render when no YOLO session is
active, leaving the row exactly as it is today. It SHALL NOT displace or replace
any existing row-1 control.

It SHALL show that YOLO is active and the remaining time, SHALL lead to the
surface where the session can be ended, and SHALL NOT be dismissible.

#### Scenario: The indicator is absent by default

- **WHEN** the sidebar header renders and no YOLO session is active
- **THEN** row 1 SHALL contain exactly the controls it contains today

#### Scenario: The indicator appears while YOLO is active

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header renders
- **THEN** row 1 SHALL additionally contain a compact YOLO indicator showing the remaining time
- **AND** every existing row-1 control SHALL still be present

#### Scenario: The indicator is not the only signal

- **GIVEN** an active YOLO session
- **WHEN** the sidebar header is not visible
- **THEN** the operator SHALL still be shown that YOLO is active by a session surface in scope

### Requirement: Row 1 carries an open-questions pill

The sidebar header's app-level control row SHALL render a compact open-questions
pill while at least one question is open for the user (see
`pending-question-stack`), placed immediately after the YOLO indicator position.
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
