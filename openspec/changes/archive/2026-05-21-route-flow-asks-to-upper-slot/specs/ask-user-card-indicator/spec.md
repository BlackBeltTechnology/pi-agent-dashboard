## MODIFIED Requirements

### Requirement: Card pulse distinguishes ask_user from processing

When a session's `currentTool` is `"ask_user"`, the session card SHALL use a distinct purple pulse animation instead of the amber working pulse used for streaming/resuming.

The purple pulse SHALL NOT activate when the pending ask_user prompt for the session has component type `flow-question` (i.e., is routed to the FlowDashboard upper slot rather than chat). For flow-routed prompts the card SHALL fall back to the amber `card-working-pulse` (since the flow itself is still executing) — the purple pulse exists specifically to draw attention to the **chat** input cue, which is suppressed for flow-routed prompts.

#### Scenario: Session waiting for ask_user input (chat-routed)
- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session has no pending PromptBus request with component type `"flow-question"`
- **THEN** the card applies the `card-input-pulse` CSS class (purple tint)
- **AND** does NOT apply `card-working-pulse`

#### Scenario: Session waiting for ask_user input (flow-routed)
- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session has a pending PromptBus request with component type `"flow-question"`
- **THEN** the card does NOT apply `card-input-pulse`
- **AND** the card applies `card-working-pulse` if `session.status === "streaming"`

#### Scenario: Session streaming normally
- **WHEN** `session.status === "streaming"` and `currentTool` is not `"ask_user"`
- **THEN** the card applies `card-working-pulse` (amber tint, unchanged behavior)

#### Scenario: Session idle or ended
- **WHEN** `session.status` is `"idle"` or `"ended"` and `currentTool` is not set
- **THEN** no pulse class is applied

### Requirement: ActivityIndicator shows "Waiting for input" for ask_user

The `ActivityIndicator` component SHALL display a distinct label when the session is executing the `ask_user` tool, EXCEPT when the pending prompt is flow-routed (component type `flow-question`), in which case the indicator SHALL fall back to its generic streaming label since the flow's own visualization already conveys the "waiting on you" cue in the upper slot.

#### Scenario: ask_user tool active, chat-routed
- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending PromptBus request is not flow-routed
- **THEN** the activity indicator shows "Waiting for input" in purple text
- **AND** does NOT show the generic "⚡ ask_user" tool indicator

#### Scenario: ask_user tool active, flow-routed
- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending PromptBus request has component type `"flow-question"`
- **THEN** the activity indicator does NOT show "Waiting for input"
- **AND** the indicator falls back to the standard streaming display (the flow's upper-slot question card carries the "input pending" cue)

#### Scenario: Other tool active
- **WHEN** `session.currentTool` is set to any value other than `"ask_user"`
- **THEN** the activity indicator shows the tool name with flash icon in yellow (unchanged)
