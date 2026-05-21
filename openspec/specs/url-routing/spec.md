## Purpose

URL routing for the dashboard SPA — defines the route table, deep-link / refresh handling, history navigation, and the contract for sidebar-triggered overlays vs URL-route views.
## Requirements
### Requirement: Route definitions
The client SHALL define routes for `/` (landing page) and `/session/:id` (session view). Any unmatched route SHALL redirect to `/`.

#### Scenario: Navigate to root
- **WHEN** user navigates to `/`
- **THEN** the landing page is displayed with the sidebar and an empty main area showing a "Select a session" hint

#### Scenario: Navigate to session route
- **WHEN** user navigates to `/session/:id` where `:id` is a valid session ID
- **THEN** that session's chat view is displayed and the session is highlighted in the sidebar

#### Scenario: Navigate to unknown route
- **WHEN** user navigates to an unrecognized path (e.g., `/foo/bar`)
- **THEN** the app redirects to `/`

### Requirement: URL-derived session selection
The selected session ID SHALL be derived from the URL path parameter, not from component state. All downstream components SHALL receive `selectedId` the same way as before.

#### Scenario: selectedId from URL
- **WHEN** the current URL is `/session/abc-123`
- **THEN** `selectedId` is `abc-123` and passed to all child components

#### Scenario: No selectedId at root
- **WHEN** the current URL is `/`
- **THEN** `selectedId` is `undefined`

### Requirement: Session selection navigates via push
Clicking a session in the sidebar SHALL navigate to `/session/:id` using push history (not replace).

#### Scenario: Click session in sidebar
- **WHEN** user clicks a session card in the sidebar
- **THEN** the browser URL changes to `/session/:id` and a new history entry is created

#### Scenario: Browser back after session selection
- **WHEN** user selects session A, then session B, then presses browser back
- **THEN** the URL returns to `/session/<sessionA-id>` and session A is displayed

### Requirement: Back navigation button
The session header SHALL display a back button. The back button on both desktop and mobile SHALL invoke `window.history.back()` when browser history has more than one entry, and SHALL fall back to `navigate("/")` on cold loads (history length === 1). No priority-chain dispatcher, no overlay-state cleanup, no URL-route auto-close logic.

#### Scenario: Back from sidebar-opened overlay returns to prior URL
- **GIVEN** the user is on `/settings` on desktop or mobile
- **WHEN** the user clicks a sidebar P/D/T/S artifact letter, which navigates to `/folder/:encodedCwd/openspec/:changeName/:artifactId`
- **AND** then clicks the back button
- **THEN** the URL SHALL return to `/settings`
- **AND** the SettingsPanel SHALL be rendered

#### Scenario: Back from session detail with empty history
- **GIVEN** the user is on `/session/abc` on desktop
- **AND** browser history has only one entry (cold load / hard refresh / deep link)
- **WHEN** the user clicks the back button
- **THEN** the URL SHALL change to `/`
- **AND** LandingPage SHALL be rendered

#### Scenario: Back unwinds chained overlay URLs naturally
- **GIVEN** the user navigated `/` → `/session/abc` → `/folder/:cwd/openspec/:c/proposal` → `/folder/:cwd/openspec/archive`
- **WHEN** the user clicks the back button repeatedly
- **THEN** each click SHALL pop one URL from history in reverse order

### Requirement: Deep-link session on refresh
When the page is refreshed at `/session/:id`, the app SHALL restore that session once session data arrives via WebSocket.

#### Scenario: Refresh at session URL
- **WHEN** user refreshes the page at `/session/abc-123`
- **THEN** once sessions load via WebSocket, session `abc-123` is selected and its chat is displayed

#### Scenario: Refresh at session URL with unknown ID
- **WHEN** user refreshes at `/session/unknown-id` and no session with that ID exists after sessions load
- **THEN** the app redirects to `/`

### Requirement: SPA fallback on server
The server SHALL return `index.html` for any GET request that does not match a static file, API endpoint, or WebSocket path.

#### Scenario: Server serves index.html for client routes
- **WHEN** a GET request is made to `/session/abc-123`
- **THEN** the server responds with `index.html` (HTTP 200)

#### Scenario: Server still serves static files
- **WHEN** a GET request is made to `/assets/main.js`
- **THEN** the server responds with the actual static file

### Requirement: Mobile depth derives from route matches
The mobile `getMobileDepth` SHALL derive depth from `useRoute` match flags, not from `useState` overlay flags. Specifically:
- Depth 0 (list) when only `/` matches
- Depth 1 (detail) when `/session/:id`, `/folder/:cwd/...`, `/terminal/:id`, `/settings`, or `/tunnel-setup` matches without an overlay sub-route
- Depth 2 (preview) when any of the new overlay routes match

#### Scenario: Depth 2 on overlay route
- **WHEN** the URL is `/folder/:encodedCwd/openspec/:changeName/:artifactId` on mobile
- **THEN** `getMobileDepth({ hasOverlayRoute: true, ... })` SHALL return `2`

#### Scenario: Settings route sets mobile depth to 1
- **WHEN** the current URL is `/settings` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Settings page

#### Scenario: Tunnel setup route sets mobile depth to 1
- **WHEN** the current URL is `/tunnel-setup` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Zrok Install Guide

#### Scenario: Folder terminals route sets mobile depth to 1
- **WHEN** the current URL is `/folder/:encodedCwd/terminals` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the TerminalsView for the decoded cwd

### Requirement: Folder terminals route
The client SHALL define a route `/folder/:encodedCwd/terminals` that displays the TerminalsView for the decoded folder path. The `encodedCwd` SHALL be base64url-encoded.

#### Scenario: Navigate to folder terminals
- **WHEN** user navigates to `/folder/:encodedCwd/terminals`
- **THEN** the TerminalsView SHALL be displayed for the decoded cwd
- **THEN** the folder group SHALL be visually indicated in the sidebar

#### Scenario: Invalid encoded cwd
- **WHEN** user navigates to `/folder/invalid-base64/terminals`
- **THEN** the app SHALL redirect to `/`

### Requirement: Folder editor route
The client SHALL define a route `/folder/:encodedCwd/editor` that displays the EditorView for the decoded folder path.

#### Scenario: Navigate to folder editor
- **WHEN** user navigates to `/folder/:encodedCwd/editor`
- **THEN** the EditorView SHALL be displayed for the decoded cwd

### Requirement: OpenSpec proposal preview route
The client SHALL define a route `/folder/:encodedCwd/openspec/:changeName/:artifactId` that renders the OpenSpec proposal preview for the specified change and artifact. `:encodedCwd` is base64url-encoded via `encodeFolderPath`. `:changeName` and `:artifactId` are `encodeURIComponent`-encoded.

#### Scenario: Direct navigation to preview URL
- **WHEN** user navigates to `/folder/:encodedCwd/openspec/my-change/proposal`
- **THEN** the OpenSpecPreview component SHALL be rendered with `cwd`, `changeName="my-change"`, and `initialArtifact="proposal"` derived from the URL

#### Scenario: Refresh on preview URL
- **WHEN** user refreshes the page at the preview URL with no in-memory state
- **THEN** the page SHALL show a loading state until WebSocket replay populates `openspecMap`
- **THEN** the preview SHALL render once data is available

#### Scenario: Invalid change name in URL
- **WHEN** user navigates to a preview URL with a `:changeName` that does not exist in the folder's openspec data
- **THEN** the page SHALL render a "Not found" inline component with a back button — NOT redirect to `/` automatically

### Requirement: OpenSpec archive browser route
The client SHALL define a route `/folder/:encodedCwd/openspec/archive` that renders the archive browser for the specified folder.

#### Scenario: Navigate to archive URL
- **WHEN** user navigates to `/folder/:encodedCwd/openspec/archive`
- **THEN** ArchiveBrowserView SHALL be rendered with the decoded `cwd`

### Requirement: OpenSpec specs browser route
The client SHALL define a route `/folder/:encodedCwd/openspec/specs` that renders the specs browser for the specified folder.

#### Scenario: Navigate to specs URL
- **WHEN** user navigates to `/folder/:encodedCwd/openspec/specs`
- **THEN** SpecsBrowserView SHALL be rendered with the decoded `cwd`

### Requirement: README preview route
The client SHALL define a route `/folder/:encodedCwd/readme` that renders the README preview for the specified folder.

#### Scenario: Navigate to README URL
- **WHEN** user navigates to `/folder/:encodedCwd/readme`
- **THEN** MarkdownPreviewView SHALL be rendered with the README content fetched via `/api/readme?cwd=...`

### Requirement: Pi resources index route
The client SHALL define a route `/folder/:encodedCwd/pi-resources` that renders the pi resources browser for the specified folder.

#### Scenario: Navigate to pi-resources URL
- **WHEN** user navigates to `/folder/:encodedCwd/pi-resources`
- **THEN** PiResourcesView SHALL be rendered with the decoded `cwd`

### Requirement: Pi resource file preview route
The client SHALL define a route `/pi-resource` that accepts query parameters `path` (URL-encoded absolute filesystem path) and `title` (URL-encoded display title) and renders the resource file preview.

#### Scenario: Navigate to pi-resource URL
- **WHEN** user navigates to `/pi-resource?path=...&title=...`
- **THEN** MarkdownPreviewView SHALL be rendered with content fetched via `/api/pi-resource-file?path=...`
- **AND** the page header SHALL display the decoded `title`

#### Scenario: Missing path parameter
- **WHEN** user navigates to `/pi-resource` without a `path` query parameter
- **THEN** the page SHALL redirect to `/`

### Requirement: Session file diff route
The client SHALL define a route `/session/:id/diff` that renders the file diff view for the specified session.

#### Scenario: Navigate to diff URL
- **WHEN** user navigates to `/session/abc/diff`
- **THEN** FileDiffView SHALL be rendered for session `abc`
- **AND** the diff data SHALL be fetched via `/api/session-diff?sessionId=abc`

### Requirement: Shell overlay URL reflects current state
For every full-content-area view owned by the shell (i.e. excluding plugin-contributed `content-view` claims), the current URL SHALL be the single source of truth for which view is rendered. Shell components SHALL NOT keep parallel `useState` flags that determine which overlay is active. State derivable from the URL (cwd, change name, artifact id, session id, query params) SHALL be read from `useRoute` params or `URLSearchParams`, not from in-memory copies.

#### Scenario: URL is sole source of truth for shell overlays
- **GIVEN** any shell overlay route in the proposal table is the current URL
- **WHEN** the page is hard-refreshed
- **THEN** the same overlay SHALL re-render once any required async data resolves
- **AND** no `useState` flag in `App.tsx` or `useContentViews` SHALL gate that rendering

#### Scenario: Plugin-owned overlays remain out of scope
- **GIVEN** a plugin contributes a `content-view` claim selected by predicate (e.g. `flows-plugin`'s `FlowAgentDetailClaim` / `FlowArchitectDetailClaim` / `FlowYamlPreviewClaim`)
- **WHEN** that overlay is active
- **THEN** the URL is NOT required to reflect it under this requirement
- **AND** a follow-up change covers URL participation for plugin claims

### Requirement: Sidebar interactions push onto browser history
Every sidebar action that opens a shell-owned content-area view (OpenSpec artifact letters, README links, pi-resource links, archive browser, specs browser, file-diff toggle) SHALL invoke `navigate(<route>)` with default push semantics. Replace semantics SHALL NOT be used unless explicitly required for an invalid-URL redirect.

#### Scenario: Sidebar action grows browser history
- **GIVEN** the user is on any URL with `window.history.length === N`
- **WHEN** the user clicks any sidebar action that opens a shell-owned content-area view
- **THEN** `window.history.length` SHALL be `N + 1` after the navigation
- **AND** clicking back SHALL restore the previous URL

### Requirement: Plugin-owned overlay routes are dispatched exclusively via `shell-overlay-route`

URL routes that belong to a plugin (full-screen pages mounted at the top of the shell, e.g. subagent popout, flow agent popout, future plugin overlays) SHALL be dispatched via the `shell-overlay-route` slot. The shell (`packages/client/src/App.tsx`) SHALL:

- NOT contain any `useRoute(<plugin-owned-path>)` call for plugin pages.
- NOT import any plugin popout component (`SubagentPopoutPage`, `FlowAgentPopoutPage`, `*PopoutClaim`, or equivalent).
- Mount exactly one `<ShellOverlayRouteSlot>` at the top of the desktop overlay switch.
- Mount exactly one `<ShellOverlayRouteSlot>` inside `MobileShell.detailPanel`.
- Treat the slot's match state as the single source of truth for "is a plugin overlay active?" via `useShellOverlayRouteMatched()`.

When a plugin overlay claim matches, the slot's element SHALL render as the top-level content for that layout. The shell SHALL NOT fall through to `LandingPage`, `sessionDetail`, or any plugin-content-view slot for that URL.

Pre-existing direct-dispatch code in App.tsx for `SubagentPopoutPage` (the `useRoute("/session/:sessionId/subagent/:agentId")` call, its decoded params, its cold-open subscribe effect, and both desktop+mobile dispatch arms) SHALL be removed.

#### Scenario: Desktop deep-link to a plugin overlay route renders the claim

- **GIVEN** the viewport is at desktop width
- **AND** the subagents-plugin has registered a `shell-overlay-route` claim with `config.path: "/session/:sessionId/subagent/:agentId"`
- **WHEN** the URL is `/session/sess_1/subagent/agent_x`
- **THEN** `<ShellOverlayRouteSlot>` SHALL render the subagents-plugin's claim component as the top-level content
- **AND** `LandingPage` SHALL NOT be rendered
- **AND** no session-detail JSX gated by `selectedId` SHALL be rendered

#### Scenario: Mobile deep-link to a plugin overlay route renders the claim

- **GIVEN** the viewport is at mobile width
- **WHEN** the URL is `/session/sess_1/flow/my-pipe/agent/agent_3`
- **THEN** `MobileShell.detailPanel` SHALL render the flows-plugin's claim component via the slot consumer
- **AND** `LandingPage` SHALL NOT be rendered inside `detailPanel`

#### Scenario: No matching overlay claim falls through cleanly

- **WHEN** the URL has no matching `shell-overlay-route` claim
- **THEN** `<ShellOverlayRouteSlot>` SHALL render `null`
- **AND** the shell SHALL render the next branch in its dispatch chain (folder view, session detail, landing) as before

#### Scenario: Shell static-analysis ban

- **WHEN** static analysis (or a repo-lint test) inspects `packages/client/src/App.tsx`
- **THEN** the file SHALL NOT contain `from "@blackbelt-technology/pi-dashboard-subagents-plugin"` imports for `SubagentPopoutPage` or `SubagentPopoutClaim`
- **AND** the file SHALL NOT contain `from "@blackbelt-technology/pi-dashboard-flows-plugin"` imports for `FlowAgentPopoutPage` or `FlowAgentPopoutClaim`
- **AND** the file SHALL NOT contain a `useRoute` call whose path begins with a plugin-owned namespace (`/session/:*/subagent/...`, `/session/:*/flow/...`)

#### Scenario: Single slot mount per layout

- **WHEN** static analysis scans `packages/client/src/App.tsx`
- **THEN** the file SHALL contain at most two `<ShellOverlayRouteSlot` JSX mounts (one for the desktop overlay switch, one for `MobileShell.detailPanel`)

