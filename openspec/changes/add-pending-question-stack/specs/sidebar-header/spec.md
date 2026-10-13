## ADDED Requirements

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
