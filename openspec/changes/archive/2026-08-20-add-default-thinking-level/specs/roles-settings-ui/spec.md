## ADDED Requirements

### Requirement: Thinking level paired with the role model

The role model-picker SHALL render a thinking-level control beside the
model-selector primitive, using the shared `ui:thinking-level-selector`
primitive. The control's selectable levels SHALL be derived from the picked
model's `supportedThinkingLevels` as supplied by the plugin config `models`
list; when the picked model advertises no level set, the primitive's fallback
set SHALL be used.

The chosen level SHALL be persisted as a `:<level>` suffix on the role's
existing ref string (`"<provider>/<id>:<level>"`) — the roles section SHALL NOT
introduce a second field or a parallel level map. Choosing the no-override
option SHALL strip the suffix, leaving a bare `"<provider>/<id>"` ref.

A ref that already carries a suffix SHALL display its base model in the model
selector and its level in the thinking control. Changing the model SHALL
preserve the chosen level when the newly picked model supports it, and SHALL
drop the suffix when it does not.

Level picks SHALL follow the same deferred-persistence contract as model picks:
staged in `pending` and flushed only by the host Settings panel's Save action,
never dispatched at selection time.

#### Scenario: Level control renders beside the model picker

- **WHEN** the user opens the model-picker for a role
- **THEN** a thinking-level control SHALL render beside the model selector
- **AND** its selectable levels SHALL be limited to the picked model's `supportedThinkingLevels`

#### Scenario: Level encoded as a ref suffix

- **WHEN** the user picks model `anthropic/claude-sonnet-4-5` and level `high` for `@planning`
- **THEN** the staged value for `@planning` SHALL be `"anthropic/claude-sonnet-4-5:high"`
- **AND** no separate level field SHALL be written

#### Scenario: No-override strips the suffix

- **WHEN** a role's staged ref is `"anthropic/claude-sonnet-4-5:high"` and the user selects the no-override option
- **THEN** the staged value SHALL become `"anthropic/claude-sonnet-4-5"` with no suffix

#### Scenario: Existing suffixed ref splits for display

- **WHEN** a persisted role value is `"anthropic/claude-sonnet-4-5:high"`
- **THEN** the model selector SHALL show `anthropic/claude-sonnet-4-5` as current
- **AND** the thinking control SHALL show `high` as current
- **AND** the pill SHALL NOT be marked dirty by rendering alone

#### Scenario: Level dropped when the new model does not support it

- **WHEN** a role holds `"<provider>/<a>:xhigh"` and the user picks model `<provider>/<b>` whose `supportedThinkingLevels` omits `xhigh`
- **THEN** the staged value SHALL be `"<provider>/<b>"` with no suffix

#### Scenario: Level pick is deferred like a model pick

- **WHEN** the user changes only the thinking level for a role
- **THEN** the pill SHALL show the unsaved (dirty) marker
- **AND** no role-mutation message SHALL be sent to the server until the host Save action runs
