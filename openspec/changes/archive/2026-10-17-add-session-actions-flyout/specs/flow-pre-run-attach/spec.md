## ADDED Requirements

### Requirement: Session actions menu offers an Open flow action

The desktop session card's actions menu SHALL offer an **Open flow…** action, as part of the flows plugin's PLUGINS contribution, whenever flows is available for the session (per `flows-plugin` "Flow actions and the FLOWS subcard are gated separately") and the session's available-flows list is non-empty. Activating it SHALL close the menu and open a searchable picker listing every flow in the session's available-flows list (project-local and package-provided flows alike), each with its name and description. The action SHALL be disabled, with an explanatory tooltip, while any flow in that session is running.

#### Scenario: Open action visible with flows available
- **WHEN** flows is available for a session, its available-flows list contains at least one flow, and no flow is running
- **THEN** the session actions menu SHALL show an enabled **Open flow…** action

#### Scenario: Picker lists all available flows
- **GIVEN** a session whose available-flows list contains a project flow `test:capabilities` and a package flow
- **WHEN** the user activates **Open flow…** in the session actions menu
- **THEN** the picker SHALL open and stay open after the menu closes
- **AND** it SHALL list both flows by name with their descriptions

#### Scenario: Open action disabled while a flow runs
- **WHEN** a flow in the session is running
- **THEN** the **Open flow…** action SHALL be disabled and SHALL indicate that a flow is running

#### Scenario: Open action hidden with no flows
- **WHEN** the session's available-flows list is empty
- **THEN** no **Open flow…** action SHALL be shown

## REMOVED Requirements

### Requirement: FLOWS subcard offers an Open flow action
**Reason**: Flow actions move from the FLOWS subcard into the desktop session actions menu (`session-actions-menu`). The FLOWS subcard now carries flow status only.
**Migration**: Use **Open flow…** in the session actions menu's PLUGINS group. See "Session actions menu offers an Open flow action".
