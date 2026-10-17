## ADDED Requirements

### Requirement: Project-init applies the workflow schema only to new OpenSpec projects

After project-init successfully runs `openspec init --tools pi --force` in mode `offer` (the target had no `openspec/` before), the skill SHALL request `POST /api/openspec/workflow-schema { cwd, action: "enable" }`, but only when the dashboard config sets `openspec.workflowSchema.defaultForNewProjects` to `true`. The step SHALL be listed in the Step 3c preview (paths `openspec/schemas/pi-spec-driven/` and `openspec/config.yaml`) before the user confirms, and the skill SHALL NOT request it when the user declines. It SHALL report the written paths in its summary.

In mode `repair` (an existing `openspec/`) the skill SHALL NOT request the enable flow. When the dashboard is unreachable, the call fails, or the flag is absent or false, the skill SHALL skip this step, complete the init, and say how to enable the schema later from Settings → OpenSpec.

#### Scenario: Default on, new project

- **GIVEN** `defaultForNewProjects` is `true`, the dashboard is reachable, and `/repo/new` has no `openspec/`
- **WHEN** project-init initializes OpenSpec in `/repo/new`
- **THEN** the skill SHALL call the enable flow for `/repo/new`
- **AND** its summary SHALL list `openspec/schemas/pi-spec-driven/` and `openspec/config.yaml`

#### Scenario: Repair mode never enables

- **GIVEN** `defaultForNewProjects` is `true` and `/repo/old/openspec/` exists without pi skills
- **WHEN** project-init repairs it
- **THEN** the skill SHALL NOT call the enable flow

#### Scenario: Dashboard unreachable

- **GIVEN** `defaultForNewProjects` is `true` but the dashboard API cannot be reached
- **WHEN** OpenSpec init succeeds in mode `offer`
- **THEN** the skill SHALL skip the enable step, complete the init, and tell the user to enable it from Settings → OpenSpec
