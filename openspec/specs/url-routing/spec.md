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
The session header SHALL display a back button. On desktop, clicking the back button SHALL invoke a unified back handler that pops content-area overlays in priority order before falling back to URL navigation, and SHALL never be a silent no-op. On mobile, existing behaviour SHALL be preserved.

#### Scenario: Desktop back with no overlays and no history
- **GIVEN** the user is on desktop at `/session/abc-123`
- **AND** the browser history has only one entry (cold load / hard refresh / deep link / post-server-switch)
- **WHEN** the user clicks the session-header back button
- **THEN** the app SHALL navigate to `/` and display `LandingPage`
- **AND** the click SHALL NOT be a silent no-op (regardless of whether `window.history.back()` would do nothing)

#### Scenario: Desktop back with overlay set
- **GIVEN** the user is on desktop with any of the eight content-area overlay states set (archive, specs, flowYaml, diff, piResourceFile, readme, piResources, openspecPreview)
- **WHEN** the user clicks the session-header back button OR the overlay's own back button
- **THEN** the highest-priority overlay state SHALL be cleared (set to null)
- **AND** the URL SHALL NOT change as a result of that single click

#### Scenario: Desktop back unwinds chained overlays one click per layer
- **GIVEN** the user has multiple overlay states set (e.g. `previewState` and `flowYamlPreview` both non-null)
- **WHEN** the user clicks the back button repeatedly
- **THEN** each click SHALL clear exactly one overlay state in priority order until all are cleared
- **AND** further clicks (with no overlays remaining) SHALL navigate to `/`

#### Scenario: Mobile back unchanged
- **WHEN** a user on mobile clicks the back button or completes a swipe-back gesture
- **THEN** the existing mobile `onBack` priority switch SHALL apply unchanged

#### Scenario: Back button visibility
- **WHEN** a session is selected (URL is `/session/:id`)
- **THEN** the back button is visible in the session header

### Requirement: Sidebar overlays auto-close URL-route views
When a sidebar action opens a content-area overlay (OpenSpec preview, README preview, pi resource file preview) while the user is on a URL-routed view that takes over the content area (`/settings` or `/tunnel-setup`), the URL-route view SHALL be closed automatically before the overlay is shown.

#### Scenario: Click sidebar OpenSpec artifact while on /settings
- **GIVEN** the user is on `/settings` on desktop
- **WHEN** the user clicks a P/D/T/S artifact letter in a sidebar folder's OpenSpec section
- **THEN** the URL SHALL change to `/` (Settings closes)
- **AND** the OpenSpec preview SHALL render in the content area
- **AND** the SettingsPanel SHALL no longer be in the DOM

#### Scenario: Click sidebar README link while on /tunnel-setup
- **GIVEN** the user is on `/tunnel-setup` on desktop
- **WHEN** the user clicks a README link from a sidebar folder
- **THEN** the URL SHALL change to `/`
- **AND** the README preview SHALL render in the content area

#### Scenario: Click sidebar pi resource while on /settings
- **GIVEN** the user is on `/settings` on desktop
- **WHEN** the user clicks a pi resource link (skill / extension / prompt) from a sidebar folder
- **THEN** the URL SHALL change to `/`
- **AND** the pi resource preview SHALL render in the content area

#### Scenario: Single back click reaches landing page after sidebar-triggered overlay
- **GIVEN** the user opened an overlay from the sidebar while on `/settings` (per the scenarios above)
- **WHEN** the user clicks the overlay's back button once
- **THEN** the overlay state SHALL clear
- **AND** the user SHALL land on `LandingPage` (or `sessionDetail` if a session is selected) — NOT back on Settings

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

### Requirement: Mobile depth includes settings and tunnel routes
The mobile `MobileShell` depth calculation SHALL treat `/settings` and `/tunnel-setup` as depth-1 routes, alongside `/session/:id` and `/terminal/:id`.

#### Scenario: Settings route sets mobile depth to 1
- **WHEN** the current URL is `/settings` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Settings page

#### Scenario: Tunnel setup route sets mobile depth to 1
- **WHEN** the current URL is `/tunnel-setup` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Zrok Install Guide

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

### Requirement: Legacy terminal route
The `/terminal/:id` route SHALL be kept for backward compatibility but is deprecated. New terminal access SHALL use `/folder/:encodedCwd/terminals`. The legacy route SHALL continue to render the existing TerminalView for the selected terminal.

#### Scenario: Legacy terminal route still works
- **WHEN** user navigates to `/terminal/:id` with a valid terminal ID
- **THEN** the terminal SHALL be displayed using the existing TerminalView

#### Scenario: New terminal creation uses folder route
- **WHEN** a new terminal is created via the folder action bar
- **THEN** the app SHALL navigate to `/folder/:encodedCwd/terminals` (not `/terminal/:id`)
