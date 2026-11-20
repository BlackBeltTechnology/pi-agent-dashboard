## MODIFIED Requirements

### Requirement: Role thinking level follows one precedence

For an `@role` ref the resolver SHALL pick the thinking level by precedence: explicit `thinkingLevel` field > ref `:<level>` suffix > role-assigned level. The level SHALL never be appended to `--model`. On every road, a choice carrying only a thinking level SHALL be paired with the configured default model when one exists. When the configured default model is a role ref (`@<role>` or `@<role>:<level>`), the pairing SHALL resolve it against the current role map first and pair the resolved `provider/id`, with the choice's explicit thinking level winning. When the pairing's default role ref does not resolve (unknown role, unassigned, or assigned a value without `provider/`), the spawn SHALL proceed without `--model`, the failure SHALL be logged, and the pairing SHALL NOT add a warning, a `choiceWarning`, or a REST error, because the request itself carried no model. A request that carries the role ref as its own `model` (for example a spawn surface that promoted the Settings default) SHALL keep the existing unresolvable-role handling of the dropped-choice requirement.

#### Scenario: Explicit thinking level beats the role level
- **GIVEN** role `planning` is assigned `anthropic/claude-opus-5-5:high`
- **WHEN** a spawn arrives with `model: "@planning"` and `thinkingLevel: "low"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-opus-5-5` and `--thinking low`

#### Scenario: Ref suffix beats the role level
- **GIVEN** role `planning` is assigned `anthropic/claude-opus-5-5:high`
- **WHEN** a spawn arrives with `model: "@planning:medium"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-opus-5-5` and `--thinking medium`

#### Scenario: Thinking-only choice pairs with the default model
- **GIVEN** Settings `defaultModel` is `anthropic/claude-sonnet-5-5`
- **WHEN** a REST or plugin spawn arrives with only `thinkingLevel: "high"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5 --thinking high`

#### Scenario: Thinking-only choice pairs with a role default
- **GIVEN** Settings `defaultModel` is `@planning` and role `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** a REST or plugin spawn arrives with only `thinkingLevel: "low"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5 --thinking low`

#### Scenario: Thinking-only choice with an unresolved role default
- **GIVEN** Settings `defaultModel` is `@validate` and `validate` has no model in the current role map
- **WHEN** a REST spawn arrives with only `thinkingLevel: "low"`
- **THEN** the request SHALL succeed
- **AND** pi SHALL be spawned without `--model` and with `--thinking low`

#### Scenario: Promoted role default that does not resolve warns
- **GIVEN** Settings `defaultModel` is `@validate` and `validate` has no model in the current role map
- **WHEN** the user spawns from the folder home without changing the model chip
- **THEN** pi SHALL be spawned without `--model`
- **AND** `spawn_result` SHALL carry a `choiceWarning` naming `validate`

#### Scenario: Role default reaches pi with the role level from a spawn surface
- **GIVEN** Settings `defaultModel` is `@planning`, `defaultThinkingLevel` is `""`, and role `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** the user spawns from the folder home without changing the model or thinking chip
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5` and `--thinking high`
