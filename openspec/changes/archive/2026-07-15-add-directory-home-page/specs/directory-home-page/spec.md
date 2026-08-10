## ADDED Requirements

### Requirement: Bare directory route

The client SHALL register a bare route `/folder/:encodedCwd` (both the desktop and
the mobile route chains) that renders the directory home page. The route MUST NOT
match or shadow the deeper `/folder/:encodedCwd/{terminals,editor,settings,openspec,pi-resources,view}`
routes.

#### Scenario: Bare folder URL renders the home page

- **WHEN** the user navigates to `/folder/<encodedCwd>` for a pinned directory
- **THEN** the directory home page SHALL render (not the terminals/editor/settings surface, and not the root `LandingPage`)

#### Scenario: Deeper folder routes still resolve

- **GIVEN** the bare `/folder/:encodedCwd` route is registered
- **WHEN** the user navigates to `/folder/<encodedCwd>/terminals`
- **THEN** the terminals surface SHALL render and the bare home page SHALL NOT render

#### Scenario: Mobile back returns to the predecessor

- **GIVEN** a mobile viewport on `/folder/<encodedCwd>`
- **WHEN** the user triggers back
- **THEN** navigation SHALL pop to the surface the user came from (not treat the home page as depth-0)

### Requirement: Pinned-directory guard

The directory home page SHALL render only for cwds present in `pinnedDirectories`.
A non-pinned cwd reached by direct URL SHALL render a "not pinned" notice with a
pin call-to-action instead of the prompt surface. The guard SHALL wait for the
pinned-directory list to load before deciding, showing a loading state until then,
so a cold load or refresh never flashes the not-pinned notice for a pinned cwd.

#### Scenario: Non-pinned cwd shows the not-pinned notice

- **GIVEN** `<cwd>` is not in the loaded `pinnedDirectories`
- **WHEN** the user opens `/folder/<encodedCwd>`
- **THEN** a "not pinned" notice with a pin CTA SHALL render and no prompt SHALL be shown

#### Scenario: Cold load does not flash the not-pinned notice

- **GIVEN** `pinnedDirectories` has not yet loaded (empty on first WS connect)
- **AND** `<cwd>` is in fact a pinned directory
- **WHEN** the user opens `/folder/<encodedCwd>` directly
- **THEN** a loading state SHALL render until the pinned list arrives
- **AND** once loaded the prompt surface SHALL render (the not-pinned notice SHALL NOT flash)

### Requirement: Sidebar open affordance

Each pinned-directory sidebar row SHALL expose an "open" affordance distinct from the
collapse toggle that navigates to `/folder/:encodedCwd`. Activating it SHALL NOT
toggle the folder's collapsed state and SHALL NOT initiate a drag-reorder.

#### Scenario: Open affordance navigates to the home page

- **WHEN** the user activates the open affordance on a pinned-directory row
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: Open affordance does not toggle collapse

- **GIVEN** a pinned folder is expanded
- **WHEN** the user activates its open affordance
- **THEN** the folder SHALL remain expanded (the collapse state is unchanged)

### Requirement: Centered prompt spawns a session

The directory home page SHALL present a vertically-centered prompt (built on
`CommandInput`) with no active session. On send it SHALL spawn a session in that
directory by calling `handleSpawnSession(cwd, undefined, { initialPrompt: <text> })`
(the initial prompt carrying the typed text) and SHALL disable the send control
while a spawn initiated from this page is in flight. v1 SHALL NOT render a model
picker; the spawn uses pi's default model.

#### Scenario: Send spawns with the typed text as initial prompt

- **GIVEN** the user typed a non-empty prompt on the directory home page for `<cwd>`
- **WHEN** the user sends
- **THEN** the client SHALL send `spawn_session` for `<cwd>` carrying `initialPrompt` equal to the typed text

#### Scenario: Send is disabled while a spawn is in flight

- **GIVEN** the user has sent a prompt and the spawn has not yet correlated
- **WHEN** the user attempts to send again
- **THEN** the send control SHALL be disabled so a second concurrent spawn is not issued

#### Scenario: Empty prompt does not spawn

- **WHEN** the user activates send with an empty/whitespace-only prompt
- **THEN** no `spawn_session` SHALL be sent

### Requirement: Navigate to the spawned session

After a send-initiated spawn, the client SHALL navigate to `/session/:newId` for the
newly created session, reusing the existing exact `requestId` → `session_added`
correlation.

#### Scenario: Lands in the new session after spawn

- **GIVEN** the user sent a prompt from the directory home page
- **WHEN** the spawned session's `session_added` arrives echoing the request's `requestId`
- **THEN** the client SHALL navigate to `/session/<newId>`

### Requirement: Directory home content

The directory home page SHALL show a folder-name header, a list of that directory's
existing sessions, and quick actions linking to the directory's terminals, editor,
and settings routes. The page SHALL serve as the folder's empty state when it has no
sessions, without presenting a second onboarding surface that conflicts with the root
`LandingPage`.

#### Scenario: Populated folder lists its sessions

- **GIVEN** the pinned directory has one or more sessions
- **WHEN** the directory home page renders
- **THEN** it SHALL show those sessions and the quick actions alongside the prompt

#### Scenario: Empty folder shows the centered prompt

- **GIVEN** the pinned directory has no sessions
- **WHEN** the directory home page renders
- **THEN** the centered prompt SHALL be the focal point and the session list SHALL be empty
