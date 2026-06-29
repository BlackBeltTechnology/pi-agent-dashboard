# ask-user-card-indicator — delta

## REMOVED Requirements

### Requirement: ActivityIndicator shows "Waiting for input" for ask_user
**Reason:** Renamed and re-specified. The label "Waiting for input" was shared
with the passive idle state (H4 consistency violation). The blocked-on-you state
now has its own requirement "ActivityIndicator shows \"Needs you\" for ask_user"
(ADDED below); the idle state gets a separate "Idle" label requirement.

## ADDED Requirements

### Requirement: ActivityIndicator shows "Needs you" for ask_user

The `ActivityIndicator` component SHALL display the distinct label **"Needs
you"** when the session is executing the `ask_user` tool (chat-routed),
disambiguating it from the passive idle state. It SHALL fall back to its generic
streaming label when the pending prompt is flow-routed / widget-bar-placed
(component type `flow-question`, `architect-prompt`, etc.) since the slot owning
that prompt already conveys the cue. The blocked-on-you state SHALL be conveyed
by **icon + label + color + dot shape** together, never by color alone.

#### Scenario: ask_user tool active, chat-routed

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending PromptBus request is not widget-bar-placed
- **THEN** the activity indicator shows **"Needs you"** with the comment-question icon in the `--status-needs-you` color
- **AND** does NOT show the generic "⚡ ask_user" tool indicator
- **AND** does NOT show the string "Waiting for input"

#### Scenario: ask_user tool active, flow-routed

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the pending PromptBus request has a widget-bar-placed component type
- **THEN** the activity indicator does NOT show "Needs you"
- **AND** the indicator falls back to the standard streaming display

#### Scenario: Other tool active

- **WHEN** `session.currentTool` is set to any value other than `"ask_user"`
- **THEN** the activity indicator shows the tool name with flash icon in the `--status-working` color (unchanged behavior)

### Requirement: Idle (turn-finished) state uses a distinct label

The `ActivityIndicator` SHALL display **"Idle"** (muted), NOT "Waiting for input", when a session is `idle`/`active` with no `currentTool` set. The string "Waiting for input" SHALL NOT be shared between the `ask_user`
(blocked) state and the `idle`/`active` (passive) state.

#### Scenario: Finished turn shows Idle

- **WHEN** `session.status` is `idle` or `active`
- **AND** `session.currentTool` is unset
- **THEN** the activity indicator shows "Idle" in a muted color
- **AND** does NOT show "Waiting for input"

#### Scenario: Blocked and idle labels never collide

- **WHEN** one card is `ask_user` (chat-routed) and another is `idle`
- **THEN** the two activity-indicator labels SHALL be different strings
