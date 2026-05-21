## ADDED Requirements

### Requirement: Chat suppresses widget-bar placed prompts

The dashboard chat view (`packages/client/src/components/ChatView.tsx`) SHALL NOT render an `<InteractiveUiCard>` for a message of role `interactiveUi` whose `params._promptBusComponent.type` resolves to a widget-bar placement via `isWidgetBarPrompt(componentType)` from the prompt-component registry. This applies to BOTH pending and resolved prompts.

The shell SHALL NOT pattern-match on specific component-type literals
(e.g. `"flow-question"`); it SHALL use only the placement-based
generic primitive.

#### Scenario: Flow-question prompt suppressed from chat

- **GIVEN** a session whose chat stream contains an `interactiveUi`
  message whose `params._promptBusComponent.type === "flow-question"`
  (registered with `placement: "widget-bar"`)
- **WHEN** the chat view renders
- **THEN** the `interactiveUi` message SHALL NOT produce an
  `<InteractiveUiCard>` in the rendered DOM

#### Scenario: Generic-dialog prompt still renders in chat

- **GIVEN** a session whose chat stream contains an `interactiveUi`
  message whose `params._promptBusComponent.type === "generic-dialog"`
  (registered with `placement: "inline"`)
- **WHEN** the chat view renders
- **THEN** the `interactiveUi` message SHALL render an
  `<InteractiveUiCard>` as before

#### Scenario: Suppression applies after the answer too

- **GIVEN** a flow-question prompt that was answered (status =
  `"resolved"`)
- **WHEN** the user scrolls back through chat to where the prompt
  previously appeared
- **THEN** the chat SHALL NOT contain an `<InteractiveUiCard>` for
  that prompt

### Requirement: Flow-question slot renders a transcript

`FlowQuestionsSection` (the slot consumer mounted by `FlowDashboard`) SHALL render every flow-question prompt for the active flow tab — both pending and answered — capped at the most recent N (default 10).

- Pending entries render as a full interactive card with input
  affordances (confirm / select / multiselect / input).
- Non-pending entries (status `resolved`, `cancelled`, `dismissed`)
  render as a collapsed pill showing the question text, the answer
  (when resolved), and a status icon.

Order: insertion order over the session's lifetime, oldest first.

#### Scenario: Answered question stays visible in slot

- **GIVEN** the user has answered a flow-question prompt
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the answered prompt SHALL appear as a collapsed pill in the
  transcript
- **AND** the pill SHALL show the question text plus the user's answer

#### Scenario: Pending question still rendered as full card

- **GIVEN** a flow-question prompt with status `pending`
- **WHEN** `FlowQuestionsSection` re-renders
- **THEN** the prompt SHALL render as a full interactive card with the
  appropriate input affordance for the prompt's `type`

#### Scenario: Transcript capped at N entries

- **GIVEN** more than 10 flow-question prompts exist for the active flow
- **WHEN** the transcript renders
- **THEN** only the most recent 10 SHALL be visible
- **AND** older entries SHALL be omitted (no scroll-back inside the
  slot for now)
