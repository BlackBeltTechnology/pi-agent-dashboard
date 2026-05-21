## MODIFIED Requirements

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

## ADDED Requirements

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
