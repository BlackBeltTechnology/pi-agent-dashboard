## MODIFIED Requirements

### Requirement: Create Automation entry point

The dashboard SHALL present a "Create Automation" action reachable from the folder Automations entry. The folder Automations row SHALL expose a "+ New" action that opens the create editor directly, and the board SHALL also expose a "Create Automation" action. Activating either SHALL open an editor for the trigger, action (prompt or skill), model (direct via `ModelSelector` **with a paired thinking-level control**, or `@role` via role dropdown), scope (`folder` | `global`), `mode`, and `concurrency`, and SHALL write `automation.yaml` (and `prompt.md` for prompt actions) to the chosen scope.

On the direct-model branch the editor SHALL render a thinking-level control beside the model selector, with selectable levels derived from the picked model's `supportedThinkingLevels`. The chosen level SHALL be written as a `:<level>` suffix on the existing `model` field; the no-override option SHALL write the bare `"<provider>/<id>"`.

On the `@role` branch the editor SHALL NOT render a thinking-level control: the level travels with the role's own ref, resolved at run time.

#### Scenario: Create from sidebar without opening board

- **WHEN** a user activates the "+ New" action on the folder Automations row
- **THEN** the create editor SHALL open without first navigating to the board.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

#### Scenario: Direct model with a thinking level

- **WHEN** a user picks model `anthropic/claude-sonnet-4-5` and level `high` on the direct-model branch
- **THEN** the written `automation.yaml` SHALL declare `model: "anthropic/claude-sonnet-4-5:high"`.

#### Scenario: Role branch offers no level control

- **WHEN** a user switches the model field to the `@role` branch
- **THEN** no thinking-level control SHALL render
- **AND** the written `model` value SHALL be the bare `@role` token with no suffix.
