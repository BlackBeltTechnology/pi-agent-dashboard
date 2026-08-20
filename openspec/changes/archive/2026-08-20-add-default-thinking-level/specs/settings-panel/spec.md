## ADDED Requirements

### Requirement: Default thinking level control paired with the default model

The Sessions page SHALL render a thinking-level control inside the same
`--severity-info-*` callout that hosts the `defaultModel` control, positioned
beside the Default Model selector. The control SHALL be bound to
`config.defaultThinkingLevel`. When the user changes it, the Settings panel SHALL
include `defaultThinkingLevel` in the partial sent to `PUT /api/config`.

The control's selectable levels SHALL be derived from the currently selected
Default Model's supported thinking levels (the same `supportedThinkingLevels`
source used elsewhere in the client). When the selected Default Model changes, the
selectable levels SHALL re-derive from the newly selected model.

When **no** Default Model is selected, the control SHALL be locked to `off`: it
renders and displays `off`, and no other level is selectable. In this locked
state any selection interaction SHALL be a no-op for persistence — it SHALL NOT
add `defaultThinkingLevel` to the `PUT /api/config` partial and SHALL NOT write
`"off"`. The persisted `defaultThinkingLevel` SHALL remain `""` (empty — "do not
override"), never a spurious `off` override.

#### Scenario: Control renders beside the default model

- **WHEN** the Sessions page is rendered with a Default Model selected
- **THEN** a thinking-level control SHALL appear inside the Default Model callout beside the Default Model selector

#### Scenario: Levels filter to the selected model

- **WHEN** a Default Model with a limited set of supported thinking levels is selected
- **THEN** the thinking-level control SHALL offer only that model's supported levels

#### Scenario: Levels re-derive when the default model changes

- **WHEN** the user changes the Default Model to a different model
- **THEN** the thinking-level control's selectable levels SHALL re-derive from the newly selected model

#### Scenario: Locked to off when no model is selected

- **WHEN** the Sessions page is rendered with no Default Model selected
- **THEN** the thinking-level control SHALL display `off`
- **AND** no level other than `off` SHALL be selectable
- **AND** interacting with the locked control SHALL NOT persist any value
- **AND** the persisted `defaultThinkingLevel` SHALL remain an empty string

#### Scenario: Selecting a level persists it

- **WHEN** the user selects a supported thinking level with a Default Model selected
- **THEN** the Settings panel SHALL include `defaultThinkingLevel` set to that level in the partial sent to `PUT /api/config`
