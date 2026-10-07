## ADDED Requirements

### Requirement: Model override uses the shared model selector
The `llmModelOverride` field SHALL be edited with the dashboard's shared model selector populated from the dashboard's model list, plus an explicit "inherit session model" action that clears the value. The stored value SHALL remain a `provider/id` string. A stored value that is not in the current model list SHALL still be displayed (not silently dropped) and SHALL be preserved on save unless the user changes it.

#### Scenario: Pick a model
- **WHEN** the user opens the Model override selector and chooses `anthropic/claude-sonnet-4`
- **THEN** saving writes `"llmModelOverride": "anthropic/claude-sonnet-4"`

#### Scenario: Clear to inherit
- **WHEN** the user activates "inherit session model"
- **THEN** the field shows the DEFAULT badge
- **AND** saving leaves `llmModelOverride` absent from the file, the same as the existing per-field reset, so after reload it is still reported as default and sessions inherit their own model

#### Scenario: Unknown stored model preserved
- **WHEN** the file holds `"llmModelOverride": "openrouter/deepseek/deepseek-v4-flash"` and that model is not in the model list
- **THEN** the selector shows that value and saving without edits keeps it unchanged
