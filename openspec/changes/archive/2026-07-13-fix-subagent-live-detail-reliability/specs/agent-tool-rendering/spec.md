## ADDED Requirements

### Requirement: Subagent detail opens in a dialog from the card

The `AgentToolRenderer` detail affordance SHALL open the subagent timeline in the shell `ui:dialog` primitive, mirroring the `flow-agent-detail` dialog contract, instead of a `window.open(..., "_blank")` browser popout. The dialog body SHALL render `SubagentDetailView` in `popout` mode for the card's `agentId` and `sessionId`. Because `SubagentDetailView` (via `MinimalChatView` popout mode) renders its own header (title, status, model, tokens, duration), the dialog SHALL be opened without a duplicate `title` chrome, and the view's `onBack` SHALL map to closing the dialog. The subagent card SHALL NOT open a new browser tab/window for detail.

#### Scenario: Detail opens a dialog

- **WHEN** the user activates the subagent card's detail/popout affordance
- **THEN** a `ui:dialog` SHALL open containing the subagent timeline rendered by `SubagentDetailView` in `popout` mode
- **AND** no new browser tab or window SHALL be opened

#### Scenario: Dialog dismisses

- **WHEN** the subagent detail dialog is open and the user presses Esc, clicks the overlay, or triggers the view's back/close control
- **THEN** the dialog SHALL close and the card returns to its non-expanded state

#### Scenario: Detail affordance disabled without an agent id

- **WHEN** the subagent card has no resolved `agentId` yet (or no resolved session state to render the timeline)
- **THEN** the detail/popout affordance SHALL be disabled and SHALL NOT open a dialog
- **AND** both `agentId` and the session state SHALL be resolved before the affordance is enabled
