## MODIFIED Requirements

### Requirement: Per-session override popover SHALL auto-flip direction

The `⚙ View` popover (`ChatViewMenu`) SHALL stay fully within its boundary by
delegating its open-direction and height decision to the shared
`usePopoverFlip` hook (see capability `popover-viewport-positioning`).

The popover SHALL open toward the side of the button with MORE available space
(below when below-space is larger, otherwise above), with no minimum
below-space threshold. From its composer-strip mount this means it opens upward.
Its height SHALL be clamped to that space; only the row list SHALL scroll, and
the footer actions SHALL stay visible. The list SHALL NOT scroll horizontally.

The direction SHALL be recomputed on each open and on viewport resize while open.

#### Scenario: Popover opens downward by default
- **GIVEN** the `⚙ View` button is in the upper half of the viewport
- **WHEN** the user clicks the button
- **THEN** the popover renders below the button

#### Scenario: Popover flips upward near viewport bottom
- **GIVEN** the `⚙ View` button has more space above than below, even when more than 200px is free below
- **WHEN** the user clicks the button
- **THEN** the popover renders above the button
- **AND** the footer (Reset, Set as global) is on-screen while the row list scrolls

#### Scenario: No horizontal scroll
- **GIVEN** the popover is open
- **WHEN** it renders the Notifications select with its longest option label
- **THEN** the row list's scroll width SHALL equal its client width

#### Scenario: Flip re-evaluates on viewport resize
- **GIVEN** the popover is open and positioned downward
- **WHEN** the viewport is resized so the popover would extend past the bottom
- **THEN** the popover re-positions itself upward within the same open session

## ADDED Requirements

### Requirement: View popover footer SHALL offer Reset and Set as global

The `⚙ View` popover SHALL end in a pinned footer showing the number of
overridden values (`N changed`), a **Reset** action, and a **Set as global**
action. Both actions SHALL be disabled when the session has no override.

- **Reset** SHALL send `setSessionDisplayPrefs { sessionId, override: null }`.
- **Set as global** SHALL send `PATCH /api/preferences/display` with the
  session's EFFECTIVE display prefs, and only after a successful response SHALL
  send `setSessionDisplayPrefs { sessionId, override: null }`. On failure it
  SHALL show an inline error and keep the override.

#### Scenario: Reset returns the session to global
- **GIVEN** a session with a display override
- **WHEN** the user clicks Reset
- **THEN** the client sends `setSessionDisplayPrefs` with `override: null`

#### Scenario: Set as global promotes the session view
- **GIVEN** a session whose override sets `reasoning: false`
- **WHEN** the user clicks Set as global and the PATCH succeeds
- **THEN** the PATCH body carries `reasoning: false`
- **AND** the client then clears the session override

#### Scenario: Set as global failure keeps the override
- **GIVEN** a session with a display override
- **WHEN** the user clicks Set as global and the PATCH fails
- **THEN** an inline error is shown
- **AND** no `setSessionDisplayPrefs` is sent

### Requirement: View popover SHALL render as a bottom sheet on phones

Below the `sm` breakpoint the `⚙ View` popover SHALL render as a fixed bottom
sheet at most 75% of the viewport height, over a scrim that closes it on tap,
with rows at least 44px tall. Desktop row sizing SHALL be unchanged.

#### Scenario: Phone bottom sheet
- **GIVEN** a viewport narrower than the `sm` breakpoint
- **WHEN** the user opens the `⚙ View` popover
- **THEN** it renders as a full-width bottom sheet over a scrim
- **AND** tapping the scrim closes it
