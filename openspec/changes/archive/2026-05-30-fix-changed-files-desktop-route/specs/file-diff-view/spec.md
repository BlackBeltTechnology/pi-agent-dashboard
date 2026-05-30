## MODIFIED Requirements

### Requirement: Content-area integration and button visibility
The file diff view SHALL integrate into App.tsx as a content-area view. The trigger button SHALL only appear when file changes are detected. The view SHALL render on **both** the mobile shell render path and the desktop content-area render path whenever the URL matches `/session/:id/diff`, regardless of whether the route also matches a `selectedId`-bearing pattern.

#### Scenario: Button placement
- **WHEN** the session has file changes (Write/Edit tool events detected in session state)
- **THEN** a "Changed Files" button SHALL appear in the SessionHeader, right-aligned before the Fork button

#### Scenario: Button hidden when no changes
- **WHEN** the session has no Write/Edit tool events
- **THEN** the "Changed Files" button SHALL NOT be displayed

#### Scenario: Activation
- **WHEN** the user clicks the "Changed Files" button
- **THEN** the ChatView SHALL be replaced by the file diff view
- **AND** a back button SHALL be available to return to the ChatView

#### Scenario: Desktop diff URL renders FileDiffView
- **WHEN** the user is on a desktop viewport (i.e. the `MobileShell` content path is not active) and the URL is `/session/:id/diff` for a known session id
- **THEN** the content area SHALL render `<FileDiffView>` for that session id
- **AND** the global `<LandingPage>` empty state ("Pick a session on the left to continue") SHALL NOT be displayed
- **AND** the `<SessionHeader>` SHALL remain rendered above the diff view, with the normal session controls available

#### Scenario: Mobile diff URL renders FileDiffView
- **WHEN** the user is on a mobile viewport and the URL is `/session/:id/diff` for a known session id
- **THEN** the `MobileShell` detail panel SHALL render `<FileDiffView>` for that session id
- **AND** the global `<LandingPage>` empty state SHALL NOT be displayed

#### Scenario: Session change clears view
- **WHEN** the user switches to a different session while the file diff view is open
- **THEN** the file diff view SHALL close automatically
