# Spec Delta

## MODIFIED Requirements

### Requirement: Agent tool renderer displays live progress card
The `Agent` tool renderer SHALL display a card showing the agent's current state based on `toolDetails` (cast as `AgentDetails`).

#### Scenario: Foreground agent running
- **WHEN** the Agent tool has status `running` and `toolDetails.status` is `"running"`
- **THEN** the card SHALL show: display name, description, elapsed time (live ticking), current activity, tool use count, turn count with max turns, model name (if different from parent), and config tags

#### Scenario: Foreground agent completed
- **WHEN** the Agent tool has status `complete` and `toolDetails.status` is `"completed"` or `"steered"`
- **THEN** the card SHALL show: display name, description, duration, token stats, tool use count, turn count, prompt text, and result rendered as markdown (always visible, not collapsible)

#### Scenario: Background agent launched
- **WHEN** `toolDetails.background` is `true` and `toolDetails.id` is a non-empty string, whatever the Agent tool status and `toolDetails.status` say (this scenario takes precedence over every other scenario of this requirement)
- **THEN** the card SHALL show the started card defined by `background-subagent-display`: display name, description, "Started in background", the `bg-` id from `toolDetails.id`, and a pointer to the Processes lane
- **AND** it SHALL NOT show a running spinner, elapsed time, activity or stats

#### Scenario: Agent error
- **WHEN** the Agent tool has status `error` or `toolDetails.status` is `"error"` or `"aborted"`
- **THEN** the card SHALL show: display name, description, error message, and duration

#### Scenario: No toolDetails available (fallback)
- **WHEN** the Agent tool has no `toolDetails` (e.g. replayed from older session data)
- **THEN** the renderer SHALL fall back to displaying args (prompt, description) and result as markdown (not raw JSON)

### Requirement: Subagent detail opens in a dialog from the card

The `AgentToolRenderer` detail affordance SHALL open the subagent timeline in the shell `ui:dialog` primitive, mirroring the `flow-agent-detail` dialog contract, instead of a `window.open(..., "_blank")` browser popout. The dialog body SHALL render `SubagentDetailView` in `popout` mode for the card's `agentId` and `sessionId`. Because `SubagentDetailView` (via `MinimalChatView` popout mode) renders its own header (title, status, model, tokens, duration), the dialog SHALL be opened without a duplicate `title` chrome, and the view's `onBack` SHALL map to closing the dialog. The subagent card SHALL NOT open a new browser tab/window for detail. A background started card SHALL render no detail affordance; its run is opened from the dock row.

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

#### Scenario: Background started card has no detail affordance

- **WHEN** the card is a background started card (`toolDetails.background: true` with a non-empty string `toolDetails.id`)
- **THEN** it SHALL render no Details or Popout control
- **AND** the background run SHALL be openable from its Processes-lane row
