## ADDED Requirements

### Requirement: Default model is chosen through the shared model picker

The automation settings section SHALL present the configured default model (the
fallback used when an `@role` cannot be resolved) through the shared model
picker over the dashboard's known model catalogue, not as free-text input. The
stored value SHALL remain a `provider/model-id` string; an empty string SHALL
continue to mean "no default model configured", and the user SHALL be able to
return to that state. A stored value absent from the catalogue SHALL still be
displayed as the current selection until the user picks another model or
clears it.

#### Scenario: Picking a default model

- **WHEN** the user opens the default-model control on the Automation settings
  page and selects `anthropic/claude-opus-4-7`
- **THEN** the automation settings SHALL store `"anthropic/claude-opus-4-7"` as
  the default model

#### Scenario: Free text is not accepted

- **WHEN** the user interacts with the default-model control
- **THEN** there SHALL be no way to submit a model id that is not in the
  catalogue

#### Scenario: Default model can be cleared

- **GIVEN** a default model is set
- **WHEN** the user activates the clear affordance next to the control
- **THEN** the automation settings SHALL store `""` as the default model

#### Scenario: Stale stored value remains visible

- **GIVEN** the automation config has loaded with default model `"gone/model"`
  which is not in the catalogue
- **WHEN** the Automation settings page renders
- **THEN** the control SHALL display `gone/model` as the current selection

#### Scenario: Catalogue arriving after mount populates the picker

- **GIVEN** the Automation settings page mounted before the roles catalogue was
  received
- **WHEN** the catalogue arrives
- **THEN** the default-model control SHALL list those models without a page
  reload

#### Scenario: Picker shows favorites

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the default-model control opens
- **THEN** that model SHALL show a filled ★ toggle
