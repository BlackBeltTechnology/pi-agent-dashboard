## ADDED Requirements

### Requirement: Display-preferences menu SHALL mount in the composer status bar

The per-session display-preferences popover (the "⚙ View" `ChatViewMenu`) SHALL render inside the composer `StatusBar` (the model-selector row, `data-testid="status-bar"`), positioned in the bar's `leading` cluster immediately after the refresh button and before the `ModelSelector`. It SHALL NOT render in a standalone full-width toolbar row inside `ChatView`.

The popover's behavior — editing the session's `displayPrefsOverride`, the "Use global settings" reset, and the "modified" indicator — SHALL be unchanged; only its mount location moves. The menu SHALL remain gated on an active selected session (it renders only when a session is selected).

#### Scenario: View menu renders in the status bar

- **GIVEN** a selected session
- **WHEN** the chat panel renders
- **THEN** the `⚙ View` `ChatViewMenu` SHALL appear within the `status-bar` element, after the refresh button and before the model selector
- **AND** no standalone display-prefs toolbar row SHALL render at the top of `ChatView`

#### Scenario: View menu absent when no session selected

- **GIVEN** no session is selected
- **WHEN** the shell renders the landing/content area
- **THEN** the `⚙ View` menu SHALL NOT render

#### Scenario: Toggling prefs from the status bar still works

- **GIVEN** the `⚙ View` menu mounted in the status bar for a session
- **WHEN** the user toggles a display-preference axis in the popover
- **THEN** the client SHALL send `setSessionDisplayPrefs { sessionId, override }` exactly as before the relocation
- **AND** the chat view SHALL reflect the changed preference
