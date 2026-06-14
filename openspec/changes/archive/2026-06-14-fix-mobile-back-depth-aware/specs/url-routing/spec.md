## MODIFIED Requirements

### Requirement: Back navigation button
The session header and overlay headers SHALL display a back button. The back action (back button on desktop and mobile, plus the mobile swipe-back gesture) SHALL be **depth-aware**: one back invocation moves exactly one shell depth toward the list, where depth is `getMobileDepth` (0 = list / cards, 1 = detail, 2 = overlay).

The back action SHALL resolve its target as follows:
- It MAY invoke `window.history.back()` as a fast-path ONLY when the app's tracked in-app navigation stack proves the entry it would return to is an in-app route whose depth is strictly shallower than the current depth.
- Otherwise it SHALL navigate explicitly to the computed parent route `computeBackTarget(currentRoute)`:
  - Depth 1 (`/session/:id`, `/folder/:cwd/...`, `/settings`, `/tunnel-setup`) → `/`.
  - Depth 2 `/session/:id/diff` → `/session/:id` (strip the `/diff` segment).
  - Depth 2 overlays whose URL does not encode their launching detail (`/folder/:cwd/openspec/*`, `/folder/:cwd/readme`, `/folder/:cwd/pi-resources`, `/pi-resource?…`) → `/`.
  - Depth 0 → no-op.

The back action SHALL NEVER land on a sibling route of the same depth (e.g. another `/session/:id`) and SHALL NEVER navigate outside the dashboard application. The app SHALL maintain the tracked navigation stack by appending each in-app navigation (tagged with its derived depth), overwriting the stack top on `replace`-style navigations, and realigning on `popstate`.

#### Scenario: Back from chat returns to cards regardless of prior chats
- **GIVEN** the user navigated `/` → `/session/A` → `/session/B` (both depth 1)
- **AND** the viewport is mobile so `/session/B` renders at depth 1
- **WHEN** the user clicks the back button or completes a swipe-back
- **THEN** the URL SHALL change to `/` and the session-card list SHALL be displayed
- **AND** the app SHALL NOT navigate to `/session/A`

#### Scenario: Shrinking a desktop window to mobile then back reaches cards
- **GIVEN** a session is open at `/session/abc` on a desktop-width window
- **AND** the browser history predecessor is not the dashboard list (another site, or a sibling session)
- **WHEN** the window is resized to a mobile viewport and the user invokes back
- **THEN** the URL SHALL change to `/` and the session-card list SHALL be displayed
- **AND** the app SHALL NOT leave the dashboard

#### Scenario: Back from a depth-2 overlay returns one depth up, not to a sibling overlay
- **GIVEN** the user navigated `/session/abc` → `/folder/:cwd/openspec/:c/proposal` (depth 2) → `/folder/:cwd/openspec/archive` (depth 2)
- **WHEN** the user invokes back from `/folder/:cwd/openspec/archive`
- **THEN** the app SHALL move one depth up rather than to the sibling `…/openspec/:c/proposal` overlay
- **AND** when the tracked stack proves the launching detail, the URL SHALL return to `/session/abc`; otherwise it SHALL navigate to `/`

#### Scenario: history.back() fast-path used when predecessor is a shallower in-app route
- **GIVEN** the user is on `/settings` (depth 1) and navigates to `/folder/:encodedCwd/openspec/:changeName/:artifactId` (depth 2)
- **WHEN** the user invokes back
- **THEN** the app SHALL use `window.history.back()` so the URL returns to `/settings`
- **AND** the SettingsPanel SHALL be rendered

#### Scenario: Session file diff back returns to its session
- **GIVEN** the user is on `/session/abc/diff` (depth 2)
- **WHEN** the user invokes back
- **THEN** the URL SHALL change to `/session/abc` and the chat detail SHALL be displayed

#### Scenario: Back from session detail with empty history
- **GIVEN** the user is on `/session/abc`
- **AND** browser history has only one entry (cold load / hard refresh / deep link)
- **WHEN** the user invokes back
- **THEN** the URL SHALL change to `/` and the session-card list SHALL be displayed
