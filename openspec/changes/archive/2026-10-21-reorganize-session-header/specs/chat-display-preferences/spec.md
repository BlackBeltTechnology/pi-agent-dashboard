## REMOVED Requirements

### Requirement: Display-preferences menu SHALL mount in the composer status bar
**Reason**: The composer status bar no longer exists, and the composer dock that replaces the context strip holds no chat-display controls.
**Migration**: The `⚙ View` menu mounts in the session header; see "Display-preferences menu SHALL mount in the session header".

## ADDED Requirements

### Requirement: Display-preferences menu SHALL mount in the session header

The per-session display-preferences popover (`⚙ View`, `ChatViewMenu`) SHALL render in the session header immediately after the chat/split/editor layout switch, and nowhere in the composer, the composer dock or a toolbar row inside `ChatView`. Its behavior (editing `displayPrefsOverride`, "Use global settings", the "modified" indicator) SHALL be unchanged, and it SHALL render only while a session is selected.

#### Scenario: View menu renders in the session header

- **GIVEN** a selected session
- **WHEN** the chat panel renders
- **THEN** the `⚙ View` `ChatViewMenu` SHALL appear within the session header, immediately after the layout switch
- **AND** it SHALL NOT appear in the composer or the composer dock

#### Scenario: View menu absent when no session selected

- **GIVEN** no session is selected
- **WHEN** the shell renders the landing/content area
- **THEN** the `⚙ View` menu SHALL NOT render

#### Scenario: Toggling prefs from the session header still works

- **GIVEN** the `⚙ View` menu mounted in the session header for a session
- **WHEN** the user toggles a display-preference axis in the popover
- **THEN** the client SHALL send `setSessionDisplayPrefs { sessionId, override }` exactly as before the relocation
- **AND** the chat view SHALL reflect the changed preference

## MODIFIED Requirements

### Requirement: Per-session override popover SHALL auto-flip direction

The `⚙ View` popover (`ChatViewMenu`) SHALL stay fully within its boundary by
delegating its open-direction and height decision to the shared
`usePopoverFlip` hook (see capability `popover-viewport-positioning`).

The popover SHALL open toward the side of the button with MORE available space
(below when below-space is larger, otherwise above), with no minimum
below-space threshold. From its session-header mount this means it opens downward.
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
