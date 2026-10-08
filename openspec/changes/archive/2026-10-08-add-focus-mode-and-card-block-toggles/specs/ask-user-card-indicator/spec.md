## MODIFIED Requirements

### Requirement: Card pulse distinguishes ask_user from processing

When a session's `currentTool` is `"ask_user"`, the session card SHALL
use the purple `card-input-stripes` status state EXCEPT when the session
has a pending PromptBus request whose component type resolves to a
widget-bar placement via `isWidgetBarPrompt(componentType)`. For
widget-bar-placed prompts the card SHALL fall back to
`card-working-pulse` (amber) when the session is streaming.

When the `fx-status-animation` effect resolves off (see
`card-visual-effects`), the same state selection SHALL apply but the
state SHALL render as a static tint in the same color (purple for
ask_user, amber for working) with no animation.

The shell SHALL use the generic placement-based check; it SHALL NOT
hardcode any specific component-type literal (e.g. the previous
`"flow-question"` literal SHALL be removed).

#### Scenario: Card uses purple pulse for inline-placed ask_user prompts

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session's pending PromptBus request has component type
  `"generic-dialog"` (registered with `placement: "inline"`)
- **THEN** the card SHALL apply `card-input-stripes`

#### Scenario: Card suppresses purple pulse for widget-bar prompts

- **WHEN** `session.currentTool === "ask_user"`
- **AND** the session's pending PromptBus request has component type
  registered with `placement: "widget-bar"` (e.g. `"flow-question"` or
  `"architect-prompt"`)
- **THEN** the card SHALL NOT apply `card-input-stripes`
- **AND** the card SHALL apply `card-working-pulse` if
  `session.status === "streaming"`

#### Scenario: Generic primitive lives in dashboard-plugin-runtime

- **WHEN** static analysis inspects `packages/client/src/components/session/SessionCard.tsx`
- **THEN** the file SHALL NOT contain any string literal naming a
  plugin-specific component type (no `"flow-question"`,
  `"architect-prompt"`, etc.)
- **AND** the suppression SHALL be implemented via
  `useHasWidgetBarPrompt(sessionId)` imported from
  `@blackbelt-technology/dashboard-plugin-runtime`

#### Scenario: Effects off keeps the purple cue static

- **GIVEN** `fx-status-animation` resolves off
- **WHEN** `session.currentTool === "ask_user"` with an inline-placed prompt
- **THEN** the card SHALL show a static purple tint
- **AND** no animation SHALL run on the card

## REMOVED Requirements

### Requirement: CSS animation for card-input-pulse
**Reason**: Superseded. The ask_user cue moved to the shared scrolling-stripe mechanism (`card-input-stripes`, see `ui-animation-energy` "Card status stripes are compositor-only"); no `card-input-pulse` class exists in the stylesheet any more.
**Migration**: None for users. The purple cue is `card-input-stripes`; with effects off it is a static purple tint.
