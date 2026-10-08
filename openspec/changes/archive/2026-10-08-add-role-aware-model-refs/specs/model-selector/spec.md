## ADDED Requirements

### Requirement: The model-selector primitive SHALL offer an opt-in Role tab

`ui:model-selector` SHALL accept an opt-in `allowRoles` prop. When `allowRoles` is set AND the roles plugin is installed, the picker SHALL present a Model | Role switch. The Role tab SHALL list every effective role (built-in and custom) with its current resolution (model and thinking level) or an "unassigned" marker, and selecting a role SHALL invoke `onSelect` with `@<role>`. When `current` is a role ref, the picker SHALL open on the Role tab and the trigger SHALL show the role and its current resolution. When `allowRoles` is absent, or the roles plugin is not installed, the picker SHALL render and behave exactly as before this change.

#### Scenario: Role tab hidden without opt-in
- **WHEN** a caller renders the primitive without `allowRoles`
- **THEN** no Role tab SHALL be rendered

#### Scenario: Role tab hidden without roles plugin
- **WHEN** a caller sets `allowRoles` but the roles plugin is not installed
- **THEN** no Role tab SHALL be rendered and the picker SHALL behave as the plain model picker

#### Scenario: Selecting a role emits a role ref
- **WHEN** the user picks role `fast` on the Role tab
- **THEN** `onSelect` SHALL be called with `@fast`

#### Scenario: Custom roles are listed
- **GIVEN** a custom role `doubt-verifier` exists
- **WHEN** the Role tab opens
- **THEN** `doubt-verifier` SHALL be listed alongside the built-in roles

#### Scenario: Trigger shows resolution of a bound role
- **GIVEN** `current` is `@fast` and `fast` resolves to `anthropic/claude-haiku-4-5`
- **THEN** the trigger SHALL show `@fast` together with `anthropic/claude-haiku-4-5`

#### Scenario: Unassigned role is selectable but flagged
- **WHEN** the Role tab lists a role with no assignment
- **THEN** the row SHALL be marked unassigned

### Requirement: Session model pickers SHALL resolve a role once

The StatusBar / composer model picker and the openspec run-dialog model picker SHALL enable the Role tab. Picking a role there SHALL resolve it from fresh role data at pick time (not a cached list) and change the session model to the resolved concrete model, and the thinking level to the resolved level when present AND supported by that model (an unsupported level SHALL be skipped with a notice, leaving the model change in place). The session SHALL NOT follow later changes to that role or preset. After such a pick the trigger SHALL indicate the role it was resolved from until the session model changes again.

#### Scenario: Pick a role in the status bar
- **GIVEN** `coding` resolves to `anthropic/claude-sonnet-4-5:high`
- **WHEN** the user picks `@coding` in the status-bar picker
- **THEN** the session model SHALL change to `anthropic/claude-sonnet-4-5` and the session thinking level SHALL change to `high`
- **AND** the trigger SHALL indicate "via @coding"

#### Scenario: Later preset change does not move the session
- **WHEN** after that pick the active preset reassigns `coding` to another model
- **THEN** the running session's model SHALL remain `anthropic/claude-sonnet-4-5`

#### Scenario: Unsupported resolved level is skipped
- **GIVEN** `fast` resolves to a model that does not support level `high` and the ref carries `high`
- **WHEN** the user picks `@fast` in a session picker
- **THEN** the session model SHALL change AND the thinking level SHALL NOT be set to `high` AND a notice SHALL say the level was skipped

#### Scenario: Unassigned role cannot change the session model
- **WHEN** the user picks a role that is unassigned in a session picker
- **THEN** the session model SHALL NOT change and the picker SHALL show that the role is unassigned
