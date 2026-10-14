## ADDED Requirements

### Requirement: Trusted plugins can create and start goals programmatically

The goal plugin SHALL provide a service through which another trusted plugin
creates a goal (cwd, objective, criteria, budget, optional judge) and starts its
driver, subject to the same supervision, budget and crash-loop rules as a goal
created in the Goals view. The goal SHALL carry an origin tag naming the calling
plugin and its reference, SHALL appear in the Goals view labelled with that
origin, and the caller SHALL be notified when the goal reaches a terminal status.

#### Scenario: Workflow starts a goal

- **WHEN** the workflows plugin creates a goal for change `add-x`
- **THEN** the goal SHALL be pursued under normal supervision
- **AND** the Goals view SHALL show it with origin `workflow: <workflow> / add-x`

#### Scenario: Terminal status reported

- **WHEN** the goal is satisfied, aborted, or exhausts its budget
- **THEN** the calling plugin SHALL be notified with the goal id and terminal status
