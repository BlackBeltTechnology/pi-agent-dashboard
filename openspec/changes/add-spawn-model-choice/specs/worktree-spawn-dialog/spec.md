## ADDED Requirements

### Requirement: Dialog offers one model and thinking choice for both spawn actions

The worktree spawn dialog SHALL show one merged model · thinking chip with a Role tab, next to the agent choice. The chosen model (a `provider/id` or an `@role` reference) and thinking level SHALL be sent with both the existing-worktree spawn and the create-new spawn. The chip SHALL be disabled while an ACP agent is selected, and no model or thinking level SHALL be sent then.

#### Scenario: Create-new carries the chosen model
- **GIVEN** the user opens the worktree dialog of `/repo` and picks `anthropic/claude-opus-5-5` at `high`
- **WHEN** the user creates a new worktree and spawns
- **THEN** `spawn_session` for the new worktree path SHALL carry `model: "anthropic/claude-opus-5-5"` and `thinkingLevel: "high"`

#### Scenario: Existing worktree carries a role
- **GIVEN** the user picks role `@planning` in the dialog
- **WHEN** the user clicks an existing worktree row
- **THEN** `spawn_session` SHALL carry `model: "@planning"`

#### Scenario: ACP agent disables the chip
- **WHEN** the user selects an ACP agent in the dialog
- **THEN** the chip SHALL be disabled and the spawn SHALL carry no `model` or `thinkingLevel`

### Requirement: Dialog model choice is preselected, remembered and hideable

The dialog's chip SHALL be preselected from the parent folder's remembered spawn choice, else the Settings default model and thinking level (tagged `default`), else `pi default`. Changing the chip SHALL update the parent folder's remembered spawn choice. The chip SHALL offer a `default` entry for the model and one for the thinking level; choosing either SHALL clear that field from the folder memory. A host that already owns the choice SHALL be able to hide the chip with `modelChoice="hidden"`; the dialog SHALL then send no model or thinking level of its own.

#### Scenario: Preselected from folder memory
- **GIVEN** folder `/repo` remembers spawn choice `@review`
- **WHEN** the worktree dialog of `/repo` opens
- **THEN** the chip SHALL show `@review`

#### Scenario: Settings default preselected
- **GIVEN** no remembered choice for `/repo` and Settings default model `anthropic/claude-sonnet-5-5`
- **WHEN** the dialog opens
- **THEN** the chip SHALL show `anthropic/claude-sonnet-5-5` tagged `default`

#### Scenario: Pick is remembered for the folder
- **WHEN** the user picks `@fast` in the worktree dialog of `/repo` and later clicks the New Session button of `/repo`
- **THEN** that spawn SHALL carry `model: "@fast"`

#### Scenario: Default entry clears the remembered field
- **GIVEN** folder `/repo` remembers model `@review` and thinking `high`, and Settings default model is `anthropic/claude-sonnet-5-5`
- **WHEN** the user chooses the model `default` entry in the dialog chip
- **THEN** the folder memory SHALL keep thinking `high` and hold no model
- **AND** the chip SHALL show `anthropic/claude-sonnet-5-5` tagged `default`

#### Scenario: Hidden when the host owns the choice
- **WHEN** the folder home composer opens the dialog with `modelChoice="hidden"`
- **THEN** no model chip SHALL render and the dialog's `onSpawn` options SHALL carry no `model` or `thinkingLevel`
