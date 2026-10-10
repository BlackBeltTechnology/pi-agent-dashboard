## MODIFIED Requirements

### Requirement: Mobile depth derives from route matches
The mobile `getMobileDepth` SHALL derive depth from `useRoute` match flags, not from `useState` overlay flags. Specifically:
- Depth 0 (list) when only `/` matches
- Depth 1 (detail) when `/session/:id`, `/folder/:cwd/...`, `/terminal/:id`, `/settings`, or `/tunnel-setup` matches without an overlay sub-route
- Depth 2 (preview) when any of the new overlay routes match
- Exception: when the matched route is a `shell-overlay-route` claim with `presentation: "content"`, depth SHALL be the claim's declared `depth` (`getMobileDepth` input `overlayDepth`), which takes precedence over the overlay-route depth 2. Claims with any other presentation keep depth 2.

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

#### Scenario: Content claim declares its mobile depth
- **WHEN** the URL matches a `shell-overlay-route` claim with `presentation: "content"` and `depth: 1` on mobile
- **THEN** `getMobileDepth({ hasOverlayRoute: true, overlayDepth: 1, ... })` SHALL return `1`
