## MODIFIED Requirements

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

## ADDED Requirements

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
