# directory-home-page Specification

## Purpose
TBD - created by archiving change add-directory-home-page. Update Purpose after archive.
## Requirements
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

### Requirement: Whole-row open affordance

The folder header name-row SHALL itself be the open affordance: activating it SHALL navigate
to `/folder/:encodedCwd`. The folder name SHALL carry a hover affordance so the row reads as a
link.

There SHALL be no separate icon open affordance. The row click is the only open gesture on the
card, so the destination has exactly one control.

Child controls within the row SHALL stop propagation so they perform their own action instead
of navigating.

Activating the row SHALL NOT toggle the folder's collapsed state; collapse lives solely on the
chevron in the drag gutter.

#### Scenario: Row click opens the home page

- **WHEN** the user activates a directory header row (pinned, unpinned, or workspace-owned)
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: No dedicated icon open control renders

- **WHEN** a directory header row renders
- **THEN** no separate icon-only open control SHALL render in the header cluster

#### Scenario: Child controls do not trigger whole-row navigation

- **GIVEN** a folder header row carrying the folder actions menu trigger
- **WHEN** the user activates that trigger
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page

#### Scenario: Whole-row navigation does not collapse the folder

- **GIVEN** a folder is expanded
- **WHEN** the user activates its header row
- **THEN** the folder SHALL remain expanded

#### Scenario: Folder name signals it is a link

- **WHEN** the user hovers the folder header row
- **THEN** the folder leaf name SHALL show a hover affordance indicating the row navigates

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

