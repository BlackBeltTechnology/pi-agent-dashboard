## ADDED Requirements

### Requirement: Standalone wall app at /apps/wall/
The plugin SHALL serve its built app at `/apps/wall/` through `ctx.serveApp` with `appId: "wall"`, using hash routing standalone and the host's pathname router under its base path when embedded. The standalone app SHALL show no dashboard chrome. It SHALL route `#/s/<token>` (viewer) and `#/m/<meetingId>` (operator or member), and SHALL offer *Sign in to type* through the dashboard login seam, returning to the same wall.

#### Scenario: Share link opens on a phone
- **WHEN** a participant opens `/apps/wall/#/s/<valid token>` on a phone over the tunnel
- **THEN** the board loads read-only with a viewer strip and no dashboard sidebar or header

#### Scenario: Sign in returns to the wall
- **WHEN** a viewer chooses *Sign in to type* and completes the dashboard login
- **THEN** they return to the same wall; the input bar appears only if they are on the allow-list

### Requirement: Embedded wall as a folder app
While a wall runs for a folder, the client entry SHALL provide:
- a state-only sidebar folder entry `● Live wall →`;
- folder-menu items in group `open`: *Live wall*, *Open wall standalone* and, for the owner, *Share live wall…*.

It SHALL claim `/folder/:encodedCwd/wall` (depth 2, parent `/folder/:encodedCwd`) and `/wall/:meetingId` (depth 1), both with `presentation: "content"`. Both SHALL render the same app through `<EmbeddedApp>`, and both claims SHALL stay registered whenever the plugin is enabled. `/wall/:meetingId` SHALL resolve the meeting's folder from the server and replace the location with `/folder/<encodedCwd>/wall/m/<meetingId>`; for an unknown meeting it SHALL show "Meeting ended" with the folder link when known. Embedded, the meeting title and live dot SHALL be the app's header context and *Present* an app action. Turn and speaker links SHALL open the copilot session in the dashboard.

#### Scenario: Folder entry only while live
- **WHEN** no wall runs for a folder
- **THEN** that folder shows no Live wall entry and no wall menu items

#### Scenario: Embedded beside the sidebar
- **WHEN** an operator activates `● Live wall →`
- **THEN** the wall renders in the content area with the sidebar visible, and Back returns to the folder

#### Scenario: Meeting route lands in its folder
- **WHEN** a user opens `/wall/<meetingId>` for a running meeting in `/repo/acme`
- **THEN** the location becomes `/folder/<encoded /repo/acme>/wall/m/<meetingId>` and that meeting's wall renders beside the sidebar

#### Scenario: Standalone hides dashboard links
- **WHEN** the same meeting is opened standalone
- **THEN** turn and speaker links to sessions are not rendered

### Requirement: Board, graph, transcript and figures
The app SHALL render:
- the configured board areas using upstream layout semantics (pending items with their remaining time, superseded items marked with ✕ and a reason, never strikethrough);
- graph events with a bundled cytoscape and dagre renderer;
- figures from the scoped media route;
- the transcript tab, only when the caller may read the transcript.

Each colour-coded tag and graph node SHALL carry a text label. Board updates SHALL be announced politely to assistive technology.

#### Scenario: Transcript tab absent for default viewers
- **WHEN** a viewer joins via a link with transcript visibility off
- **THEN** no Transcript tab is rendered (absent, not disabled)

#### Scenario: Graph renders offline
- **WHEN** the browser has no internet access but reaches the dashboard
- **THEN** graph views render

### Requirement: Presentation mode for a room screen
The app SHALL offer a presentation mode: full screen, large type scaling with the viewport, following upstream `show` commands, with keys F (fullscreen), ←/→ (step), A (pause or resume auto-advance) and Esc (exit). In standalone presentation the join QR code SHALL be shown when a share link is active.

#### Scenario: Auto-advance can be paused
- **WHEN** a presenter presses A
- **THEN** auto-advance stops until A is pressed again, and ←/→ still step

### Requirement: Participant states never strand the user
The app SHALL show a distinct state with a cause and a next step for each of:
- connecting;
- link expired;
- link revoked;
- meeting ended;
- invalid link;
- not allowed to type;
- reconnecting (stale content dimmed with an "out of date" notice).

It SHALL word a dead-end reason only when it learned it from a bootstrap or a `share-ended` frame, and otherwise show the generic invalid-link state. On a dropped stream it SHALL retry with exponential backoff from 2 s to 30 s, showing the reconnecting state from the first failure. After 5 minutes without a connection it SHALL show "Connection lost" with a Retry action. A `share-ended` frame SHALL stop retrying.

#### Scenario: Revoked mid-meeting
- **WHEN** a connected viewer's link is revoked
- **THEN** the board is replaced by "Link revoked" with who to ask, and the last board is not left on screen

#### Scenario: Connection lost after 5 minutes
- **WHEN** the dashboard stays unreachable for 5 minutes after a viewer's stream drops
- **THEN** retries have backed off to at most 30 s apart, and the app shows "Connection lost" with Retry

#### Scenario: Unknown token on first load
- **WHEN** a client opens a link whose token the server refuses
- **THEN** the generic "This link doesn't work" state is shown

### Requirement: Input bar states
For operator-class callers the app SHALL show an input bar with a character counter (400), and the states ready, sending, delivered (not "answered"), too long, rate-limited with the retry time, typing turned off, and not delivered with the text kept for retry.

#### Scenario: Failed input keeps the text
- **WHEN** an input post fails with a network error
- **THEN** the typed text stays in the field with a Retry action

### Requirement: No-meeting folder page with last-meeting replay
`/folder/<cwd>/wall` with no running wall SHALL show "No live meeting", a *Start meeting…* action that opens the voice-assistant start dialog when that plugin is present, and, when a replay pointer exists, the last meeting's board read-only, labelled with its title and end time. Replay SHALL be available to operator-class callers only.

#### Scenario: Stale link after the meeting
- **WHEN** an operator reloads `/folder/<cwd>/wall` after the meeting ended
- **THEN** the page shows "No live meeting" and the last meeting's board read-only, not a redirect

#### Scenario: No voice-assistant plugin
- **WHEN** the voice-assistant plugin is absent
- **THEN** *Start meeting…* is not rendered
