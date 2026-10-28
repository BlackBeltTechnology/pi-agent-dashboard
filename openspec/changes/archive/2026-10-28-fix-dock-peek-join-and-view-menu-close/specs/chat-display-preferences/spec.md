## MODIFIED Requirements

### Requirement: View popover footer SHALL offer Reset and Set as global

The `⚙ View` popover SHALL end in a pinned footer showing the number of
overridden values (`N changed`), a **Reset** action, and a **Set as global**
action. Both actions SHALL be disabled when the session has no override.

- **Reset** SHALL send `setSessionDisplayPrefs { sessionId, override: null }`.
- **Set as global** SHALL send `PATCH /api/preferences/display` with the
  session's EFFECTIVE display prefs, and only after a successful response SHALL
  send `setSessionDisplayPrefs { sessionId, override: null }`. On failure it
  SHALL show an inline error and keep the override.
- Neither action SHALL close the popover. It SHALL stay open, with the footer
  showing no success message, until the user closes it (Escape, outside click,
  the trigger, or the phone scrim).

#### Scenario: Reset returns the session to global
- **GIVEN** a session with a display override
- **WHEN** the user clicks Reset
- **THEN** the client sends `setSessionDisplayPrefs` with `override: null`
- **AND** the popover stays open

#### Scenario: Set as global promotes the session view
- **GIVEN** a session whose override sets `reasoning: false`
- **WHEN** the user clicks Set as global and the PATCH succeeds
- **THEN** the PATCH body carries `reasoning: false`
- **AND** the client then clears the session override
- **AND** the popover stays open

#### Scenario: Set as global failure keeps the override
- **GIVEN** a session with a display override
- **WHEN** the user clicks Set as global and the PATCH fails
- **THEN** an inline error is shown
- **AND** no `setSessionDisplayPrefs` is sent
