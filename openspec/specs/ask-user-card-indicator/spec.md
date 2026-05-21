# ask-user-card-indicator Specification

## Purpose
Defines how session cards visually distinguish a session waiting for human input (`ask_user`) from a session that is actively streaming or executing other tools, and how that signal is suppressed for flow-routed prompts that surface in the FlowDashboard upper slot rather than in chat.
## Requirements
### Requirement: Card pulse distinguishes ask_user from processing

When a session's `currentTool` is `"ask_user"`, the session card SHALL
use the purple `card-input-pulse` animation EXCEPT when the session has
a pending PromptBus request whose component type resolves to a
widget-bar placement via `isWidgetBarPrompt(componentType)`. For
widget-bar-placed prompts the card SHALL fall back to
`card-working-pulse` (amber) when the session is streaming.

The shell SHALL use the generic placement-based check; it SHALL NOT
hardcode any specific component-type literal (e.g. the previous
`"flow-question"` literal SHALL be removed).

#### Scenario: Card uses purple pulse for inline-placed ask_user prompts

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session's pending PromptBus request has component type
  `"generic-dialog"` (registered with `placement: "inline"`)
- **THEN** the card SHALL apply `card-input-pulse`

#### Scenario: Card suppresses purple pulse for widget-bar prompts

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session's pending PromptBus request has component type
  registered with `placement: "widget-bar"` (e.g. `"flow-question"` or
  `"architect-prompt"`)
- **THEN** the card SHALL NOT apply `card-input-pulse`
- **AND** the card SHALL apply `card-working-pulse` if
  `session.status === "streaming"`

#### Scenario: Generic primitive lives in dashboard-plugin-runtime

- **WHEN** static analysis inspects `packages/client/src/components/SessionCard.tsx`
- **THEN** the file SHALL NOT contain any string literal naming a
  plugin-specific component type (no `"flow-question"`,
  `"architect-prompt"`, etc.)
- **AND** the suppression SHALL be implemented via
  `useHasWidgetBarPrompt(sessionId)` imported from
  `@blackbelt-technology/dashboard-plugin-runtime`

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

### Requirement: CSS animation for card-input-pulse

A `card-input-pulse` keyframe animation SHALL exist in the stylesheet with a purple/violet background tint, visually distinct from the amber `card-working-pulse`.

#### Scenario: Animation definition
- **WHEN** `card-input-pulse` class is applied to an element
- **THEN** the element pulses with a purple tint (`rgba(168, 85, 247, 0.08)` at 50%)
- **AND** returns to transparent at 0% and 100%

### Requirement: ActivityIndicator suppression follows the same rule

`ActivityIndicator` SHALL hide the "Waiting for input" label when the
session has a pending widget-bar-placed prompt — the slot owning that
prompt (e.g. FlowDashboard's upper-slot question card) is already
showing the cue.

#### Scenario: ActivityIndicator skips chat-routed label for widget-bar prompt

- **WHEN** `session.currentTool === "ask_user"`
- **AND** `useHasWidgetBarPrompt(session.id)` returns `true`
- **THEN** the activity indicator SHALL NOT show "Waiting for input"
- **AND** SHALL fall back to the standard streaming display

