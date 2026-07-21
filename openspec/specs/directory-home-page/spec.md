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

### Requirement: Sidebar open affordance

Each directory sidebar row — whether pinned OR a workspace-owned folder — SHALL
expose an "open" affordance distinct from the collapse toggle that navigates to
`/folder/:encodedCwd`. Activating it SHALL NOT toggle the folder's collapsed state
and SHALL NOT initiate a drag-reorder.

#### Scenario: Open affordance appears on an UNPINNED workspace-folder row

- **GIVEN** a folder rendered inside a workspace container that is NOT pinned (its `DirectoryGroup.pinned` is `false`)
- **THEN** its row SHALL expose the "open" affordance (the render condition SHALL treat workspace membership, not only pinned state, as sufficient)

#### Scenario: Open affordance navigates to the home page

- **WHEN** the user activates the open affordance on any directory row (pinned or workspace)
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: Open affordance does not toggle collapse

- **GIVEN** a folder is expanded
- **WHEN** the user activates its open affordance
- **THEN** the folder SHALL remain expanded (the collapse state is unchanged)

### Requirement: Whole-row open affordance

The folder header name-row (folder icon, path, session count, status rollups)
SHALL itself be a click target that navigates to `/folder/:encodedCwd` for that
directory, mirroring how clicking a session card selects its session. This
whole-row affordance SHALL apply to EVERY folder row regardless of pinned or
workspace membership. Collapse/expand SHALL be exposed SOLELY via the chevron
toggle in the folder's drag gutter; the name-row click SHALL NOT toggle the
collapsed state. Child controls within the row (needs-you pill, urgency-sort,
open affordance, pin toggle) SHALL stop propagation so activating them does NOT
trigger the whole-row navigation. The dedicated icon open affordance (previous
requirement) SHALL remain as a redundant explicit control.

#### Scenario: Clicking the header row navigates to the home page

- **WHEN** the user clicks the folder header name-row (outside any child control)
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: Whole-row navigation does not collapse the folder

- **GIVEN** a folder is expanded
- **WHEN** the user clicks its header name-row
- **THEN** the folder SHALL remain expanded (collapse is owned by the chevron toggle only)

#### Scenario: Whole-row affordance applies to unpinned non-workspace folders

- **GIVEN** a folder that is neither pinned nor a workspace member
- **WHEN** the user clicks its header name-row
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` (which renders the eligibility notice with a pin call-to-action)

#### Scenario: Child controls do not trigger whole-row navigation

- **GIVEN** a folder header row with its child controls (pin toggle, urgency-sort, needs-you pill, icon open affordance)
- **WHEN** the user activates one of those child controls
- **THEN** that control's own action SHALL run and the whole-row navigation SHALL NOT fire

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

### Requirement: Directory-eligibility guard

The directory home page SHALL render for cwds that are EITHER present in
`pinnedDirectories` OR are a member folder of a workspace (i.e. present in the
union of `workspaces[].folders`). A cwd that is neither, reached by direct URL,
SHALL render a "not available" notice with a pin call-to-action instead of the
prompt surface. The pinned list and the workspace list arrive in SEPARATE messages
(`pinned_dirs_updated`, then `workspaces_updated`), so the guard SHALL wait for BOTH
to have loaded before deciding — gating on a pinned-loaded flag alone is insufficient
and SHALL NOT be used. It SHALL show a loading state until both arrive, so a cold
load or refresh never flashes the notice for an eligible cwd.

#### Scenario: Unpinned workspace-folder cwd renders the home page

- **GIVEN** `<cwd>` is a member of `workspaces[].folders` AND is NOT in `pinnedDirectories`
- **WHEN** the user opens `/folder/<encodedCwd>`
- **THEN** the directory home page prompt surface SHALL render (not the not-available notice)

#### Scenario: Neither-pinned-nor-workspace cwd shows the notice

- **GIVEN** `<cwd>` is not in the loaded `pinnedDirectories` and not in any `workspaces[].folders`
- **WHEN** the user opens `/folder/<encodedCwd>`
- **THEN** a "not available" notice with a pin CTA SHALL render and no prompt SHALL be shown

#### Scenario: Cold load does not flash the notice between the two messages

- **GIVEN** `<cwd>` is a workspace folder that is NOT pinned
- **AND** `pinned_dirs_updated` has arrived but `workspaces_updated` has NOT yet arrived
- **WHEN** the user opens `/folder/<encodedCwd>` directly
- **THEN** a loading state SHALL render (the notice SHALL NOT flash in the window before workspaces load)
- **AND** once `workspaces_updated` arrives the prompt surface SHALL render

