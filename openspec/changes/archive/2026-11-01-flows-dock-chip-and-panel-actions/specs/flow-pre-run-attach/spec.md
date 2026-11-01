## REMOVED Requirements

### Requirement: Session actions menu offers an Open flow action

**Reason**: Open flow… moves out of the session actions menu to the FLOWS dock chip and the flow panel header, so it is one click away and available wherever the dock renders.
**Migration**: See the ADDED requirement "Open flow action lives in the dock chip and the flow panel header" below and `flows-dock-chip`.

## ADDED Requirements

### Requirement: Open flow action lives in the dock chip and the flow panel header

An **Open flow…** action SHALL be offered in the FLOWS dock chip (see `flows-dock-chip`) and in the flow panel header whenever the session's flow catalog lists at least one flow. Activating it SHALL open a searchable picker listing every flow in the catalog (project-local and package-provided alike), each with its name and description. Choosing a flow SHALL put it in the flow panel as not started. The action SHALL be disabled, with the reason "A flow is running", while any flow in that session is running. The session actions menu SHALL NOT offer Open flow….

#### Scenario: Open action visible with flows available
- **WHEN** a session's catalog contains at least one flow and no flow is running
- **THEN** the dock chip SHALL show an enabled **Open flow…** action

#### Scenario: Picker lists all available flows
- **GIVEN** a session whose catalog contains a project flow `test:capabilities` and a package flow
- **WHEN** the user activates **Open flow…**
- **THEN** the picker SHALL list both flows by name with their descriptions

#### Scenario: Open action disabled while a flow runs
- **WHEN** a flow in the session is running
- **THEN** every **Open flow…** action SHALL be disabled and SHALL indicate that a flow is running

#### Scenario: Open action hidden with no flows
- **WHEN** the session's catalog is empty
- **THEN** no **Open flow…** action SHALL be shown anywhere

#### Scenario: Not in the session actions menu
- **WHEN** the user opens the session actions menu of a session with flows
- **THEN** it SHALL NOT contain **Open flow…**
