# Chat display preferences

## MODIFIED Requirements

### Requirement: Per-session override popover SHALL auto-flip direction

The `⚙ View` popover (`ChatViewMenu`) SHALL stay fully within the viewport by
delegating its open-direction and height decision to the shared
`usePopoverFlip` hook (see capability `popover-viewport-positioning`).

The default direction SHALL be downward (below the button). The popover SHALL
render above the button when it would otherwise extend past the viewport bottom,
and SHALL clamp its height with internal scroll so every row — including the
trailing "Use global settings" action and the tool-call toggles — is reachable.

The direction SHALL be recomputed on each open and on viewport resize while open.

#### Scenario: Popover opens downward by default
- **GIVEN** the `⚙ View` button is in the upper half of the viewport
- **WHEN** the user clicks the button
- **THEN** the popover renders below the button

#### Scenario: Popover flips upward near viewport bottom
- **GIVEN** the `⚙ View` button is within 200px of the viewport bottom
- **WHEN** the user clicks the button
- **THEN** the popover renders above the button instead of below
- **AND** every row including "Use global settings" is on-screen and reachable

#### Scenario: Flip re-evaluates on viewport resize
- **GIVEN** the popover is open and positioned downward
- **WHEN** the viewport is resized so the popover would extend past the bottom
- **THEN** the popover re-positions itself upward within the same open session
