## MODIFIED Requirements

### Requirement: Session model pickers SHALL resolve a role once

The StatusBar / composer model picker and the openspec run-dialog model picker SHALL enable the Role tab. Picking a role there SHALL resolve it from fresh role data at pick time (not a cached list) and change the session model to the resolved concrete model, and the thinking level to the resolved level when present AND supported by that model (an unsupported level SHALL be skipped with a notice, leaving the model change in place). The session SHALL NOT follow later changes to that role or preset. After such a pick the trigger SHALL indicate the role it was resolved from, as the translated text "from @<role>" at 12 px in `--text-secondary` after the model (`data-testid="model-via-role"` kept), until the session model changes again. Spawn-choice chips (the worktree spawn dialog chip and the folder spawn menu chip) SHALL NOT be session model pickers under this requirement: they SHALL store an `@role` reference verbatim, and the server SHALL resolve it once at spawn time. Pick notices (unassigned, level skipped, roles unavailable) SHALL render as a warning-severity callout with an icon and `role="status"`, keeping `data-testid="role-pick-notice"` / `run-config-role-notice` and `data-kind`.

#### Scenario: Pick a role in the status bar
- **GIVEN** `coding` resolves to `anthropic/claude-sonnet-4-5:high`
- **WHEN** the user picks `@coding` in the status-bar picker
- **THEN** the session model SHALL change to `anthropic/claude-sonnet-4-5` and the session thinking level SHALL change to `high`
- **AND** the trigger SHALL indicate "from @coding"

#### Scenario: Later preset change does not move the session
- **WHEN** after that pick the active preset reassigns `coding` to another model
- **THEN** the running session's model SHALL remain `anthropic/claude-sonnet-4-5`

#### Scenario: Unsupported resolved level is skipped
- **GIVEN** `fast` resolves to a model that does not support level `high` and the ref carries `high`
- **WHEN** the user picks `@fast` in a session picker
- **THEN** the session model SHALL change AND the thinking level SHALL NOT be set to `high` AND a warning callout SHALL say the model was set from the role and the level was left unchanged

#### Scenario: Unassigned role cannot change the session model
- **WHEN** the user picks a role that is unassigned in a session picker
- **THEN** the session model SHALL NOT change and the picker SHALL show that the role is unassigned

#### Scenario: Spawn-choice chip stores the role reference
- **WHEN** the user picks `@coding` in the worktree spawn dialog chip
- **THEN** the chip SHALL hold `@coding` (not its resolved model) and the spawn SHALL carry `model: "@coding"`

