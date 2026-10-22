## ADDED Requirements

### Requirement: Control skill shows a session in the browser
The `pi-dashboard-control` skill SHALL include a "View a session in the browser" section: use the full `id` or `uiUrl` / `diffUrl` from `GET /api/sessions` (never a shortened id), open it in the agent's browser (`?embed=1` for a narrow pane), let the user sign in inside the pane, treat "Session not found" as a wrong or archived id, and point to the reference's "UI routes" section.

#### Scenario: Never shorten the id
- **WHEN** the agent builds a session URL without `uiUrl`
- **THEN** the skill SHALL direct it to use `<BASE>/session/<full id>` exactly as listed

#### Scenario: Not found page
- **WHEN** the opened page shows "Session not found"
- **THEN** the skill SHALL direct the agent to re-list sessions and use a full id from the response
- **AND** for a session that is no longer listed, to look it up in `GET /api/sessions/archived` and open `<BASE>/session/<full id>?archived=1`

#### Scenario: Agent shows a session to the user
- **WHEN** the user asks the agent to show a pi session and the agent has `BASE`
- **THEN** the agent SHALL list sessions via `GET <BASE>/api/sessions` and open that row's `uiUrl` (with `?embed=1` in a narrow pane) in its browser

#### Scenario: Derived reference carries UI routes
- **WHEN** `node scripts/sync-claude-plugin.mjs` regenerates `references/api-reference.md`
- **THEN** the plugin reference SHALL contain the "UI routes (browser)" section from the extension source
- **AND** the parity test SHALL assert that section is present and SHALL pass

### Requirement: UI links never carry credentials
The control skill SHALL instruct the agent never to place a token, header value or other credential in a dashboard UI URL; when the page asks to sign in, the user signs in inside the browser pane.

#### Scenario: Listing with auth enabled
- **WHEN** auth is enabled and the agent lists sessions to find a `uiUrl`
- **THEN** the skill SHALL direct it to the existing token rules for the REST call, independent of the user's sign-in in the pane

#### Scenario: Auth enabled
- **WHEN** the opened page shows the dashboard sign-in screen
- **THEN** the agent SHALL ask the user to sign in in the browser pane
- **AND** it SHALL NOT append a token to the URL
