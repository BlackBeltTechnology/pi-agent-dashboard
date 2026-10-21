## MODIFIED Requirements

### Requirement: Resume affordance in desktop session content header
The desktop `SessionHeader` SHALL render a Resume button and a Fork button in its right-side toolbar when the displayed session has `status === "ended"` AND `sessionFile` is non-empty AND a parent-supplied `onResume` callback is present. Clicking Resume SHALL invoke `onResume("continue")`; clicking Fork SHALL invoke `onResume("fork")`. The buttons SHALL be disabled (non-interactive, visually dimmed) while `session.resuming === true`. The header meta line SHALL show a labelled clock alongside them: `ended · ran <duration>` for an ended session and `running <duration>` for an active session.

#### Scenario: Buttons render on ended session with session file
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"`, `session.sessionFile` set to a non-empty string, and a non-null `onResume` callback
- **THEN** a green Resume pill and a blue Fork pill SHALL appear in the toolbar
- **AND** the meta line SHALL show the labelled clock `ended · ran <duration>`

#### Scenario: Buttons hidden on active session
- **WHEN** the desktop `SessionHeader` is rendered with `session.status !== "ended"` (e.g., `"active"`, `"streaming"`, `"idle"`)
- **THEN** neither Resume nor Fork pills SHALL appear in the toolbar
- **AND** the meta line SHALL show the labelled clock `running <duration>`

#### Scenario: Buttons hidden when session file is missing
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"` but `session.sessionFile` is undefined or empty
- **THEN** neither Resume nor Fork pills SHALL appear

#### Scenario: Buttons hidden when onResume callback is omitted
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"` and `session.sessionFile` set, but the parent omits the `onResume` prop
- **THEN** neither Resume nor Fork pills SHALL appear (opt-in render gate)

#### Scenario: Resume click invokes callback with continue mode
- **WHEN** the user clicks the Resume button in the desktop `SessionHeader`
- **THEN** the parent-supplied `onResume` callback SHALL be invoked exactly once with the argument `"continue"`

#### Scenario: Fork click invokes callback with fork mode
- **WHEN** the user clicks the Fork button in the desktop `SessionHeader`
- **THEN** the parent-supplied `onResume` callback SHALL be invoked exactly once with the argument `"fork"`

#### Scenario: Buttons disabled while resuming
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"`, `session.sessionFile` set, `onResume` provided, and `session.resuming === true`
- **THEN** both Resume and Fork buttons SHALL render but with the `disabled` attribute set
- **AND** clicking a disabled button SHALL NOT invoke `onResume`

#### Scenario: Mobile path unaffected
- **WHEN** the `SessionHeader` is rendered on a mobile viewport
- **THEN** the mobile layout (back-arrow, title, context ring, layout menu, View, kebab) SHALL render with no attach button
- **AND** Resume SHALL continue to be reachable via the existing `MobileActionMenu` kebab entry
- **AND** the new desktop Resume / Fork pills SHALL NOT render on the mobile path
