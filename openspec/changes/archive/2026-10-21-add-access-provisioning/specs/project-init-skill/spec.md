## ADDED Requirements

### Requirement: Project-init MAY offer access provisioning after the scaffold

After the scaffold is written, the skill SHALL offer, as a separate opt-in question, to set up the project's folder access. When `.pi/access.json` exists its lines SHALL be offered; otherwise the user MAY list folders. On acceptance the skill SHALL submit them as a provisioning request through the `project-access` skill's `provision` mode and report each line's outcome. Declining, a refused request or an unanswered request SHALL NOT fail the init.

#### Scenario: Declining skips provisioning

- **WHEN** the user declines the access question
- **THEN** no provisioning request SHALL be submitted and the init SHALL complete

#### Scenario: A profile's lines are offered

- **GIVEN** the target contains `.pi/access.json` listing two folders
- **WHEN** the user accepts the access question
- **THEN** the skill SHALL submit a provisioning request with those two folders and report each outcome

#### Scenario: No operator browser does not fail the init

- **WHEN** the provisioning request is refused with `no-operator`
- **THEN** the skill SHALL tell the user to retry with the `project-access` skill later and SHALL finish the init
