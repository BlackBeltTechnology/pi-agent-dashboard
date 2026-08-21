## MODIFIED Requirements

### Requirement: All detail routes use MobileShell navigation
On mobile viewports, all detail-level routes (`/settings`, `/tunnel-setup`) SHALL render inside `MobileShell` as depth-1 detail panels with the same slide-in transition and swipe-back gesture as session chat and terminal views.

This SHALL remain true for every surface converted to a route-backed overlay. Converting a surface's desktop container to a `Dialog` SHALL NOT change its mobile presentation: on mobile the surface SHALL continue to render inside `MobileShell` at its declared depth, with the same slide-in transition and swipe-back gesture. The dialog container is a desktop-only rendering decision.

Plugin `shell-overlay-route` claims SHALL follow the same split — dialog on desktop, `MobileShell` depth panel on mobile — except where a claim declares `presentation: "page"`, which SHALL render full-viewport on both desktop and mobile, outside the `MobileShell` detail panel.

#### Scenario: Settings page on mobile
- **WHEN** a user navigates to `/settings` on a mobile viewport
- **THEN** the Settings panel SHALL slide in from the right as a MobileShell detail panel with swipe-back to return to the session list

#### Scenario: Tunnel setup page on mobile
- **WHEN** a user navigates to `/tunnel-setup` on a mobile viewport
- **THEN** the Zrok Install Guide SHALL slide in from the right as a MobileShell detail panel with swipe-back to return to the session list

#### Scenario: Swipe back from settings on mobile
- **WHEN** a user performs a swipe-back gesture on the Settings page on mobile
- **THEN** the app SHALL navigate to `/` showing the session list

#### Scenario: A converted surface renders as a depth panel, not a dialog, on mobile
- **GIVEN** a surface converted to a route-backed overlay
- **WHEN** a user navigates to it on a mobile viewport
- **THEN** it SHALL render inside `MobileShell` at its declared depth with the standard slide-in transition
- **AND** it SHALL NOT render as a desktop-style dialog

#### Scenario: A plugin overlay claim renders as a depth panel on mobile
- **GIVEN** the Goals board claim at `/folder/:encodedCwd/goals` with `depth: 2`, `parentPath: /folder/:encodedCwd`, and no declared `presentation`
- **WHEN** a user navigates to it on a mobile viewport
- **THEN** it SHALL render as a `MobileShell` detail panel at its declared depth with swipe-back
- **AND** swipe-back SHALL return to `/folder/<encodedCwd>`, NOT to `/`

#### Scenario: A `presentation: "page"` claim bypasses the MobileShell panel
- **GIVEN** a claim declaring `presentation: "page"`
- **WHEN** a user navigates to its path on a mobile viewport
- **THEN** it SHALL render full-viewport outside the `MobileShell` detail panel
