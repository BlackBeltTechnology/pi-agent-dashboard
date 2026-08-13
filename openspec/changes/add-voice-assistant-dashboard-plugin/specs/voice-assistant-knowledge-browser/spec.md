## ADDED Requirements

### Requirement: Knowledge browser is folder-scoped, not session-scoped
Knowledge is owned by a folder (the kb store opens per cwd, `set-copilot.config.json` lives at the project root), so the browser SHALL be scoped to a folder rather than to a session. The system SHALL provide a `shell-overlay-route` claim at `/folder/:encodedCwd/voice-assistant-knowledge` that derives its scope from the route's encoded cwd, plus a `sidebar-folder-section` claim as its entry point, matching the established per-folder pattern used by `kb-plugin` (`FolderKbSection` + `KbSettingsClaim`). The system SHALL NOT claim `content-view` or `command-route` for this view.

#### Scenario: Scope comes from the route, not from an active session
- **WHEN** the overlay route renders for `/folder/:encodedCwd/voice-assistant-knowledge`
- **THEN** the folder is decoded from `params.encodedCwd` and all knowledge is resolved for that folder, with no dependency on any session being active or selected

#### Scenario: Folder knowledge is reachable with no running session
- **WHEN** a folder has knowledge available but no pi session is currently running in it
- **THEN** the sidebar folder entry is still present and opening it lists that folder's knowledge normally

#### Scenario: Two sessions in one folder resolve to one view
- **WHEN** two sessions are running in the same folder
- **THEN** both reach the same single folder-scoped route, rather than presenting the folder's knowledge as two independent session-scoped views

#### Scenario: Invalid folder path in the route
- **WHEN** the route's `encodedCwd` param does not decode to a usable path
- **THEN** the view renders an explicit invalid-folder message instead of rendering an empty or misattributed knowledge list

### Requirement: Knowledge sources view
The view SHALL list the knowledge sources and recorded decisions in scope for the route's folder, read-only, resolved through the `KnowledgeBackend` seam (per `voice-assistant-knowledge-backend`). It SHALL render as a full-bleed page consistent with `kb-plugin`'s `KbSettingsPanel`, with a back affordance wired to the slot's `onBack` prop.

#### Scenario: User views resolved knowledge sources
- **WHEN** the user opens the knowledge route for a folder that has knowledge available
- **THEN** the dashboard lists the sources in scope for the active backend and the decisions found, with their id/title/status

#### Scenario: No knowledge available on either backend
- **WHEN** the user opens the knowledge route for a folder with neither an indexed kb nor configured `knowledge.sources`
- **THEN** the view shows an empty state explaining that no knowledge is configured, without erroring

#### Scenario: Back returns the user to their origin
- **WHEN** the user activates the back affordance
- **THEN** the slot's `onBack` callback is invoked rather than a hardcoded navigation target

### Requirement: Active backend is visible
The system SHALL indicate which knowledge backend is serving the view (kb or the vendored fallback), so a user can attribute differing results to the backend rather than to missing content.

#### Scenario: kb backend indicated
- **WHEN** the view renders for a folder with an indexed kb
- **THEN** it indicates that kb is the active backend

#### Scenario: Fallback backend indicated
- **WHEN** the view renders for a folder without an indexed kb
- **THEN** it indicates that the vendored fallback is active, and offers a path to index the folder with kb

### Requirement: Decisions grouped by status on the kb path
When the kb backend is active, the system SHALL group decisions by their `status` facet and show per-status counts. When the fallback backend is active, decisions SHALL be listed without facet counts.

#### Scenario: Status grouping with counts on kb
- **WHEN** the view renders with the kb backend active and decisions carrying a `status` frontmatter value
- **THEN** decisions are grouped by status with a count per status value

#### Scenario: Flat list on fallback
- **WHEN** the view renders with the fallback backend active
- **THEN** decisions are listed without status facet counts

### Requirement: Read-only in v1
The system SHALL NOT allow editing decisions or knowledge source files from this view; it is a read-only browser for v1.

#### Scenario: No write affordance present
- **WHEN** the user views a decision entry in the knowledge browser
- **THEN** no edit or delete control is presented for that entry

### Requirement: Server route backing the knowledge view
The view SHALL be served by a dedicated read-only server route that takes an explicit folder parameter, resolves through the `KnowledgeBackend` seam, and returns the resolved sources, the decisions, and the identifier of the active backend. The route SHALL reject folders outside the dashboard's known-folder allow-list and SHALL be subject to the same request authentication as other plugin REST routes.

#### Scenario: Route returns sources, decisions, and active backend
- **WHEN** the client requests knowledge for an allowed folder
- **THEN** the response contains the resolved sources, the decisions with id/title/status, and which backend produced them

#### Scenario: Folder outside the allow-list is rejected
- **WHEN** the route is called with a folder that is not a known folder
- **THEN** the request is rejected without reading from disk

#### Scenario: Route is read-only
- **WHEN** any request is made to this route
- **THEN** it cannot mutate knowledge files, configuration, or the kb index
