## MODIFIED Requirements

### Requirement: Deep-link session on refresh
When the page is loaded at `/session/:id` (including `/diff` and `/editor`), the app SHALL resolve the id after the connection's first `sessions_snapshot`, asking the server (`GET /api/sessions?id=`) when no held session matches. An id the server does not know SHALL render an inline "Session not found" state with the URL unchanged; a session that was held and is then archived, or absent after a server switch, SHALL still redirect to `/`. A resolved id SHALL stay selected across reconnects. `/session/:id?archived=1` is exempt. Scope: `/session/*` only.

#### Scenario: Refresh at session URL
- **WHEN** user refreshes the page at `/session/abc-123`
- **THEN** once sessions load via WebSocket, session `abc-123` is selected and its chat is displayed

#### Scenario: Refresh at session URL with unknown ID
- **WHEN** user loads `/session/unknown-id` and no live session has that id or a unique prefix match after the first `sessions_snapshot`
- **THEN** the content area SHALL render the "Session not found" state showing `unknown-id` and a "Back to sessions" action
- **AND** the URL SHALL remain `/session/unknown-id`
- **AND** the app SHALL NOT navigate to `/`

#### Scenario: Ended session outside the snapshot window
- **WHEN** user loads `/session/<id>` for an ended session listed by `GET /api/sessions` but absent from the connection's `sessions_snapshot`
- **THEN** the app SHALL fetch it via `GET /api/sessions?id=<id>`, add it to the held sessions, and render that session

#### Scenario: Lookup failure
- **WHEN** the `GET /api/sessions?id=` lookup fails with a network error or 5xx
- **THEN** the "Session not found" state SHALL render with a retry action and the app SHALL NOT navigate to `/`

#### Scenario: Lookup requires sign-in
- **WHEN** the `GET /api/sessions?id=` lookup returns 401 or 403
- **THEN** the app SHALL follow its existing sign-in redirect and SHALL NOT render the "Session not found" state

#### Scenario: Reconnect keeps the open session
- **WHEN** user is viewing resolved session `abc-123` and the WebSocket reconnects
- **THEN** the session view SHALL stay mounted for `abc-123` while the new snapshot is pending, and SHALL NOT show the landing page, the pending placeholder or the "Session not found" state

#### Scenario: Reconnect while viewing a looked-up ended session
- **WHEN** user is viewing an ended session that was added by the server lookup and the WebSocket reconnects with a snapshot that omits it
- **THEN** the app SHALL look it up again and keep showing it, and SHALL NOT navigate to `/`

#### Scenario: Pending placeholder
- **WHEN** a never-resolved session route is waiting for the snapshot or the lookup
- **THEN** a neutral resolving placeholder SHALL render in the session content area

#### Scenario: Unknown ID on the desktop diff route
- **WHEN** a viewport of at least 768 px loads `/session/unknown-id/diff` and the server knows no such session
- **THEN** the "Session not found" state SHALL render instead of the diff view and no diff request SHALL be made for `unknown-id`

#### Scenario: Unknown ID on the editor route
- **WHEN** user loads `/session/unknown-id/editor` and the server knows no such session
- **THEN** the "Session not found" state SHALL render instead of the editor

#### Scenario: Unknown ID on the mobile diff route
- **WHEN** a viewport below 768 px loads `/session/unknown-id/diff` and the id matches no live session after the first `sessions_snapshot`
- **THEN** the "Session not found" state SHALL render instead of the diff view

#### Scenario: Unknown ID with zero live sessions
- **WHEN** user loads `/session/unknown-id` and the first `sessions_snapshot` contains no sessions
- **THEN** the "Session not found" state SHALL render (not an empty detail pane)

#### Scenario: Not found is not shown before the snapshot
- **WHEN** user loads `/session/abc-123` and the connection's first `sessions_snapshot` has not yet arrived
- **THEN** the "Session not found" state SHALL NOT render

#### Scenario: Session archived while viewing
- **WHEN** user is viewing held session `abc-123` and it is archived
- **THEN** the app SHALL navigate to `/` and SHALL NOT render the "Session not found" state

#### Scenario: Session ended while viewing
- **WHEN** user is viewing held session `abc-123` and it receives `session_removed`
- **THEN** the session SHALL stay displayed as ended and the app SHALL NOT navigate

#### Scenario: Server switch away from an open session
- **WHEN** user is viewing held session `abc-123` and switches to another dashboard server whose snapshot lacks it
- **THEN** the app SHALL navigate to `/`

#### Scenario: No subscription before resolution
- **WHEN** user loads `/session/abc-123` and the connection is open but the first `sessions_snapshot` has not arrived
- **THEN** no session subscription SHALL be sent for `abc-123` until resolution completes

#### Scenario: Archived read-only deep link is exempt
- **WHEN** user loads `/session/old-id?archived=1` and `old-id` is not a live session
- **THEN** the archived read-only view SHALL render and the "Session not found" state SHALL NOT render

#### Scenario: Back to sessions
- **WHEN** the "Session not found" state is shown and the user activates "Back to sessions"
- **THEN** the app SHALL navigate to `/`

## ADDED Requirements

### Requirement: Session id prefix resolution
A `/session/:id` route id SHALL resolve case-insensitively to a held session id, by exact match or, for ids of at least 8 characters, by unique prefix (after the server lookup when needed). The resolved id SHALL replace the URL (no new history entry) when it differs, keeping suffix and query, and SHALL be the only id used for selection. Several matches SHALL show candidate links. An exact raw match SHALL always win.

#### Scenario: Unique prefix resolves
- **WHEN** user loads `/session/01a16086/diff?embed=1` and exactly one live session id starts with `01a16086`
- **THEN** the URL SHALL be replaced with `/session/<full-id>/diff?embed=1` and that session's diff view SHALL render

#### Scenario: Prefix never selects a non-canonical id
- **WHEN** a unique prefix resolves
- **THEN** session subscription, the viewed-session tracker and selection SHALL use the full id only and SHALL never be sent the prefix

#### Scenario: Uppercase full id is canonicalized
- **WHEN** user loads `/session/<FULL-ID-UPPERCASE>` and a held session id equals it case-insensitively
- **THEN** the URL SHALL be replaced with `/session/<held id>` and that session SHALL render

#### Scenario: Uppercase prefix resolves
- **WHEN** user loads `/session/01A16086` and exactly one live session id starts with `01a16086`
- **THEN** the URL SHALL be replaced with `/session/<full-id>`

#### Scenario: Ambiguous prefix lists candidates
- **WHEN** user loads `/session/01a16086` and two live session ids start with `01a16086`
- **THEN** the "Session not found" state SHALL render with one link per matching session pointing at `/session/<full-id>`

#### Scenario: Short prefix is not resolved
- **WHEN** user loads `/session/01a160` and exactly one live session id starts with `01a160`
- **THEN** the "Session not found" state SHALL render and the URL SHALL NOT change

#### Scenario: Exact match wins over prefix
- **WHEN** the route id equals a live session id that is also a prefix of another live session id
- **THEN** the exactly matching session SHALL render

### Requirement: Embed mode toggle
An `embed=1` query parameter on any client route SHALL enable embed mode for the browser tab, persisted in `sessionStorage`; `embed=0` SHALL disable it and clear the flag. Embed mode SHALL expose a visible "Open full dashboard" control that disables it while keeping the current path and other query parameters.

#### Scenario: Embed persists across in-app navigation
- **WHEN** embed mode was enabled via `?embed=1` and the user navigates in-app to `/session/<id>/diff` (no query)
- **THEN** embed mode SHALL still be on

#### Scenario: Independent tab is not affected
- **WHEN** embed mode is on in one tab and the dashboard is opened in a separate tab that was not opened from it, without `embed`
- **THEN** that tab SHALL render the normal shell

#### Scenario: Leaving embed mode keeps other parameters
- **WHEN** the user activates "Open full dashboard" on `/session/<id>?archived=1`
- **THEN** the app SHALL replace the URL (no new history entry) with `/session/<id>?archived=1&embed=0`, clear the flag, and render the normal shell with the archived view

#### Scenario: Embed survives sign-in
- **WHEN** auth is enabled and an unauthenticated user opens `/session/<id>?embed=1` in a tab and completes sign-in in that tab
- **THEN** the user SHALL return to `/session/<id>` with embed mode on
- **AND** no credential SHALL appear in any URL

### Requirement: Embed mode layout
While embed mode is on, the app SHALL keep the viewport's shell but SHALL NOT render the session list: the desktop shell omits the session sidebar, sidebar hamburger and mobile overlay, and the mobile shell's list panel shows an embed home message. Session views, settings, route-backed overlays, plugin overlay routes, banners and toasts SHALL be unchanged.

#### Scenario: Embed session view hides the sidebar
- **WHEN** user opens `/session/<id>?embed=1` in a 1024 px wide viewport
- **THEN** the session chat and composer SHALL render
- **AND** no session sidebar, sidebar hamburger, or session list SHALL be rendered

#### Scenario: Narrow embed shows the session, not the list
- **WHEN** user opens `/session/<id>?embed=1` in a 400 px wide viewport
- **THEN** the mobile shell SHALL show the session detail at depth 1
- **AND** navigating back to depth 0 SHALL show the embed home message, not the session list

#### Scenario: Overlay routes still work in embed
- **WHEN** embed mode is on and the user opens a plugin overlay route or `/settings`
- **THEN** that surface SHALL render as it does outside embed mode

#### Scenario: Embed home has no session list
- **WHEN** embed mode is on and the route is `/`
- **THEN** the content area SHALL show a short "no session selected" message with the "Open full dashboard" control instead of the session list
