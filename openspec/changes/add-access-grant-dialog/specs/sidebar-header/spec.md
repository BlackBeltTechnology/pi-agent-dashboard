## ADDED Requirements

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
