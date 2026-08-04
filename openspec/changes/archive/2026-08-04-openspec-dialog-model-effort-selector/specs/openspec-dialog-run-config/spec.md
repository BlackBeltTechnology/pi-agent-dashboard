## ADDED Requirements

### Requirement: Run-config row in OpenSpec launch dialogs
The `ExploreDialog`, `ProposeDialog`, and `NewChangeDialog` SHALL each render a run-config row in their footer containing a model selector and a thinking-effort selector, above the Cancel/action buttons and separated from the fields by a top border. The row SHALL be labelled "Runs with". Both controls SHALL always be visible — never collapsed behind a disclosure. The model selector SHALL be the shared `ModelSelector` component and the effort selector SHALL be the shared `ThinkingLevelSelector` component, both unmodified.

#### Scenario: Explore dialog renders the run-config row
- **WHEN** the user opens the Explore dialog on a session whose model is `anthropic/claude-sonnet-4-6` and thinking level is `high`
- **THEN** the dialog footer SHALL contain a model trigger reading `anthropic/claude-sonnet-4-6` and an effort trigger reading `high`
- **AND** both triggers SHALL be enabled

#### Scenario: Propose and NewChange dialogs render the same row
- **WHEN** the user opens the Propose dialog or the New Change dialog
- **THEN** each SHALL render the same run-config row with the same `data-testid` values as the Explore dialog

### Requirement: Controls default to the session's current values
Both selectors SHALL default to the attached session's current model and thinking level. When the session reports no model, the model trigger SHALL show a neutral placeholder rather than an empty control.

#### Scenario: Defaults inherit from the session
- **WHEN** the session's model is `openai/gpt-5.1-codex` and thinking level is `xhigh`
- **AND** the user opens any of the three dialogs
- **THEN** the model trigger SHALL read `openai/gpt-5.1-codex` and the effort trigger SHALL read `xhigh`

#### Scenario: Session model changes while the dialog is open
- **WHEN** the dialog is open showing model `A`, the user has NOT changed the control, and the session's model changes to `B` from another surface
- **THEN** the dialog's model trigger SHALL update to `B`

### Requirement: Selection is sticky and applied to the session
Changing either control SHALL change the session's model or thinking level for subsequent turns, not only for the prompt being launched. The dialog SHALL apply the change by emitting the existing `set_model` and `set_thinking_level` browser messages for the attached session. No per-run override mechanism SHALL be introduced.

#### Scenario: Changing the model applies it to the session
- **WHEN** the user changes the model from `anthropic/claude-sonnet-4-6` to `openai/gpt-5.1-codex` and clicks the send action
- **THEN** a `set_model` message SHALL be sent with `provider: "openai"` and `modelId: "gpt-5.1-codex"` for that session
- **AND** after the dialog closes, the composer's model selector SHALL show `openai/gpt-5.1-codex`

#### Scenario: Unchanged controls emit nothing
- **WHEN** the user opens a dialog, types a prompt, and clicks the send action without touching either control
- **THEN** NO `set_model` message SHALL be sent
- **AND** NO `set_thinking_level` message SHALL be sent
- **AND** the prompt SHALL be sent immediately with no intermediate state

### Requirement: Sticky side-effect is disclosed before sending
When either control differs from the session's current value, the dialog SHALL render a text disclosure stating that the change applies to the session and not only to this run. When neither control has been changed, the dialog SHALL NOT render that disclosure. The disclosure SHALL be conveyed as text and SHALL NOT rely on color alone.

#### Scenario: Disclosure appears once a control is changed
- **WHEN** the user changes the model selection to a value different from the session's model
- **THEN** the dialog SHALL display text conveying that the model changes for the session, not just this run

#### Scenario: No disclosure in the clean state
- **WHEN** the dialog is open and neither control has been changed
- **THEN** no disclosure text SHALL be rendered, and no vertical space SHALL be reserved for it

#### Scenario: Reverting to the session value clears the disclosure
- **WHEN** the user changes the model away from the session value and then selects the session's original value again
- **THEN** the disclosure SHALL be removed

### Requirement: Prompt is gated on model/effort confirmation
When the user has changed either control, the dialog SHALL emit the `set_model` and/or `set_thinking_level` messages, then wait for the session to report the new values before sending the prompt. While waiting, the send action SHALL be disabled, both selectors SHALL be disabled, and the dialog SHALL render a status message announced via `role="status"` with `aria-live="polite"`. The dialog SHALL NOT close until the prompt has been sent.

#### Scenario: Prompt sends after confirmation
- **WHEN** the user changed the model and clicks the send action
- **THEN** `set_model` SHALL be sent first
- **AND** the prompt SHALL NOT be sent until the session reports the new model
- **AND** once the session reports the new model, the prompt SHALL be sent and the dialog SHALL close

#### Scenario: Confirmation times out
- **WHEN** the user changed the model, clicks the send action, and the session does not report the new model within the timeout window
- **THEN** the prompt SHALL be sent anyway
- **AND** the user SHALL be informed that the model may not have been applied

#### Scenario: Cancel during the pending window
- **WHEN** the dialog is waiting for confirmation and the user clicks Cancel or presses Escape
- **THEN** the dialog SHALL close without sending the prompt
- **AND** the already-emitted model change SHALL remain in effect

### Requirement: Model list is requested when the dialog opens
Each dialog SHALL emit `request_models` for the attached session when it opens, so the selector reflects a current list.

#### Scenario: Opening a dialog refreshes the model list
- **WHEN** the user opens the Explore, Propose, or New Change dialog for session `s1`
- **THEN** a `request_models` message SHALL be sent with `sessionId: "s1"`

### Requirement: Degraded state when the model list is unavailable
When no model list is available for the session, the model selector SHALL render as a disabled control showing the session's current model together with a text explanation, rather than an empty or absent control. The effort selector SHALL remain interactive, and the send action SHALL NOT be blocked.

#### Scenario: Dialog opens before the model list arrives
- **WHEN** the user opens a dialog and no model list has been received for that session
- **THEN** the model trigger SHALL be disabled and SHALL display the session's current model
- **AND** a message SHALL explain that models are loading and the session's current model will be used
- **AND** the effort selector SHALL remain enabled
- **AND** the send action SHALL remain enabled

#### Scenario: Model list arrives while the dialog is open
- **WHEN** the model list is received while the dialog is open
- **THEN** the model trigger SHALL become enabled without the dialog closing or losing typed input

### Requirement: Run-config state is provided by a shared context
The model/effort values and their setters SHALL be exposed to the dialogs through a shared React context provided once at the application root, rather than passed as props through `SessionOpenSpecActions`. The consuming hook SHALL throw when used outside the provider.

#### Scenario: All three mount sites supply the context
- **WHEN** the OpenSpec actions are rendered from the session card, the composer, or the mobile action menu
- **THEN** the run-config row SHALL render with the session's values in every case

#### Scenario: Missing provider fails loudly
- **WHEN** a dialog consuming the run-config hook is rendered without the provider
- **THEN** the hook SHALL throw, rather than rendering a silently degraded row

### Requirement: Run-config row meets the accessibility floor
Every control in the run-config row SHALL have an accessible name, SHALL expose its popover state via `aria-haspopup`, `aria-expanded`, and `aria-controls`, and SHALL present a visible focus indicator. Text in the row SHALL meet WCAG 2.1 AA contrast (4.5:1) in every shipped theme. Interactive targets SHALL be at least 24x24 CSS pixels, and at least 44x44 CSS pixels in the stacked layout used at narrow viewports.

#### Scenario: Row is keyboard operable
- **WHEN** the user tabs through the dialog
- **THEN** focus SHALL reach the model trigger and the effort trigger with a visible focus indicator on each

#### Scenario: Row stacks without clipping on narrow viewports
- **WHEN** the dialog is rendered at a 375px viewport width
- **THEN** the run-config row SHALL stack vertically with no horizontal overflow
- **AND** each control SHALL present a target at least 44x44 CSS pixels
