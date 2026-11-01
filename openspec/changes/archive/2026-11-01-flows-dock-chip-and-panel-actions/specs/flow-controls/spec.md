## ADDED Requirements

### Requirement: Live flow header offers Open flow and Edit

The live flow panel header SHALL offer **Open flow…** and **Edit…** beside Abort. While the flow is running, Open flow… SHALL be disabled with the reason "A flow is running"; Edit… SHALL stay enabled. The opened-but-not-started panel header SHALL offer Open flow… (to pick a different flow) and Edit… beside its existing Run control; that header never shows while a flow runs, because a running flow replaces it.

#### Scenario: Running flow header
- **WHEN** a flow is running
- **THEN** the header SHALL show Open flow… (disabled, "A flow is running"), Edit… and Abort

#### Scenario: Swap the opened flow before starting
- **GIVEN** `ship-it` is open but not started
- **WHEN** the user activates Open flow… and picks `batch:apply`
- **THEN** the panel SHALL show `batch:apply` as not started
