## ADDED Requirements

### Requirement: Automation row exposes a run-now control

The automation row SHALL, for a valid automation that is not currently running,
expose a visible, enabled run-now control addressable by the stable test id
`automation-run-now` that triggers a manual run-now for that automation, in
addition to the existing enable/disable control. A running automation SHALL show
a Stop control in its place (no run-now), and an invalid automation SHALL offer
no run-now control. The row SHALL be selectable by the stable `auto-row` class.

#### Scenario: Valid idle row offers run-now

- **WHEN** the row for a valid, non-running automation renders
- **THEN** it SHALL expose an enabled `automation-run-now` control that fires a run-now for that automation
- **AND** the enable/disable control SHALL remain present

#### Scenario: Running row shows Stop, not run-now

- **WHEN** the row for an automation with an active run renders
- **THEN** it SHALL show a Stop control and SHALL NOT expose the run-now control

#### Scenario: Invalid row offers no run-now

- **WHEN** the row for an invalid automation renders
- **THEN** it SHALL NOT expose the run-now control
