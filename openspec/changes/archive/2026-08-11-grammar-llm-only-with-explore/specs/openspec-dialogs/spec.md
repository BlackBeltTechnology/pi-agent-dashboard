## ADDED Requirements

### Requirement: Grammar checking in the prose OpenSpec dialogs

The Explore dialog and the New Change dialog SHALL mount the composer grammar
panel over their freeform prose field via the shared `ComposerPanelSlot`
(`composer-panel` slot consumer), forwarding the field's current text as the
read-only `draft` and the field's setter as the bounded `onApplyText`, with no
`sessionId`. When the grammar plugin is disabled or unclaimed, the slot SHALL
render nothing and the dialogs SHALL behave exactly as before. The Propose dialog
(single-line name input, no prose field) SHALL NOT mount the slot.

#### Scenario: Explore dialog offers grammar checking over its prose
- **WHEN** the Explore dialog is open with the grammar feature enabled and a
  model configured
- **THEN** a `ComposerPanelSlot` SHALL render below the explore textarea, bound
  to the textarea's text (`draft`) and setter (`onApplyText`)
- **AND** applying a correction SHALL rewrite only the textarea text, never send
  the prompt

#### Scenario: New Change description offers grammar checking
- **WHEN** the New Change dialog is open with the grammar feature enabled and a
  model configured
- **THEN** a `ComposerPanelSlot` SHALL render below the description textarea,
  bound to the description text and setter
- **AND** the change-name single-line input SHALL NOT be grammar-checked

#### Scenario: Propose dialog is unchanged
- **WHEN** the Propose dialog is open
- **THEN** no grammar panel SHALL be mounted (its only field is a single-line
  name/description input)

#### Scenario: Feature disabled leaves the dialogs unchanged
- **WHEN** the grammar plugin is disabled or does not claim `composer-panel`
- **THEN** the Explore and New Change dialogs SHALL render exactly as they did
  before this change, with no grammar affordance and no extra network calls

#### Scenario: Enabled but no model configured surfaces the same state as the composer
- **WHEN** a prose dialog mounts the slot with the feature enabled but no LLM
  model configured
- **THEN** the panel SHALL behave exactly as the chat composer does in that state
  (the check surfaces the `backend_unconfigured` outcome), NOT a dialog-specific
  path
- **AND** no correction SHALL be applied to the field until a model is configured
