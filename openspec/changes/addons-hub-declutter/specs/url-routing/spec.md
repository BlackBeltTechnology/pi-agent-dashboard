## MODIFIED Requirements

### Requirement: Route-backed overlay container

A converted surface SHALL keep its URL as the addressing contract and SHALL choose its container as a rendering decision independent of that URL. On desktop a converted surface SHALL render in a `Dialog` over a scrim over a pinned background underlay. On mobile it SHALL render inside `MobileShell` at its declared depth.

A matched overlay SHALL NOT render any lower-priority branch **derived from the current location** — session detail, landing, or otherwise. Exactly one branch SHALL be derived from the URL at any time.

The launching route SHALL nevertheless remain visible behind the dialog, rendered as a **pinned background underlay** from a location source independent of `window.location`. The background path SHALL be captured at navigation time and frozen for the overlay's lifetime; on a cold load, where no background was captured, it SHALL be synthesized from `computeBackTarget` of the current route. The underlay SHALL be `aria-hidden`, outside the overlay's focus trap, and non-interactive, and its scroll position SHALL be retained for the overlay's lifetime.

Where the frozen background path ceases to be valid while the overlay is open (its session ended, its folder was removed), the underlay MAY render stale or empty state; dismissal SHALL still navigate to the launching route and resolve through the normal route-matching path.

The guarantee this requirement makes is about **dismissal**, not visibility: dismissing a converted surface SHALL return to the route that launched it.

The following surfaces SHALL be route-backed overlays. Every path pattern below is unchanged by this requirement (the folder-settings default page id is not part of the pattern; its rename is governed by `directory-settings-page`, and old page ids redirect):

- `/settings/:page?/:sub?`
- `/folder/:cwd/settings/:page?` (the page segment is optional; it defaults to `add-ons`; the legacy segment `packages` replace-redirects to `add-ons`)
- `/folder/:cwd/openspec/:changeName/:artifactId`
- `/folder/:cwd/view?path=`
- `/pi-view?url=`
- `/pi-resource?path=`
- `/tunnel-setup`

For each converted surface, the path, its deep link, its browser back button, and its `RouteDescriptor` depth SHALL be preserved exactly. Converting a container SHALL NOT require a change to any e2e `goto(...)` target or to any spec that names one of these paths.

`/folder/:cwd/openspec` (the kanban board) SHALL remain a full page; a board requires horizontal width that a dialog would constrain. `/session/:id/diff` and `/session/:id/editor` SHALL remain full routes and SHALL NOT be dialog-ised; they are read-while-working surfaces. `/pair` SHALL be untouched, as it branches before the router mounts and never enters it.

Dismissing a converted surface — backdrop click, `Esc`, or its close affordance — SHALL mean *leave this surface*, returning to the route that launched it. It SHALL NOT be specified as a single `history.back()` step: a surface that pushes history entries for its own internal navigation would otherwise land on its own earlier state with the container still open. The renderer SHALL unwind the surface's own pushed entries, or navigate directly to the tracked launching route. When no tracked predecessor exists (cold load), the target SHALL be resolved from the `RouteDescriptor` table.

#### Scenario: Settings deep link is unchanged by the container swap

- **WHEN** a client navigates directly to `/settings/security` on a desktop viewport
- **THEN** the settings surface SHALL render at that URL
- **AND** the URL SHALL remain `/settings/security`

#### Scenario: Opening settings from a session keeps the session visible behind it

- **GIVEN** the user is on `/session/abc` on a desktop viewport
- **WHEN** the user opens `/settings/general`
- **THEN** the settings surface SHALL render in a dialog over a scrim
- **AND** the session detail SHALL be rendered behind it as the pinned underlay, `aria-hidden` and non-interactive
- **AND** the session detail SHALL be derived from the frozen background path `/session/abc`, NOT from the current location

#### Scenario: Cold-loaded overlay synthesizes its underlay from the back target

- **GIVEN** no in-app navigation has occurred in this document
- **WHEN** the user loads `/settings/security` directly
- **THEN** the settings surface SHALL render in a dialog over a scrim
- **AND** the underlay SHALL be rendered from `computeBackTarget("/settings/security")`
- **AND** dismissal SHALL NOT be a no-op

#### Scenario: Dismissing settings returns to the launching route

- **GIVEN** the user opened `/settings/general` from `/session/abc`
- **WHEN** the user presses `Esc`
- **THEN** the URL SHALL return to `/session/abc`

#### Scenario: Dismissal leaves the surface even after internal navigation

- **GIVEN** the user opened `/settings/general` from `/session/abc`
- **AND** navigated within the surface to `/settings/plugins/x`, which pushes a history entry
- **WHEN** the user presses `Esc`
- **THEN** the surface SHALL be dismissed entirely
- **AND** the URL SHALL return to `/session/abc`, NOT to `/settings/general`

#### Scenario: Navigating to a route the overlay owns switches in place

- **GIVEN** the user opened `/settings/general` from `/session/abc`
- **WHEN** code inside the surface navigates to `/settings/gateway`
- **THEN** the overlay container SHALL remain mounted rather than remounting
- **AND** the frozen background SHALL remain `/session/abc`
- **AND** state held by the surface SHALL survive the switch

#### Scenario: Navigating outside the overlay's ownership dismisses it

- **GIVEN** the user opened `/settings/general` from `/session/abc`
- **WHEN** code inside the surface navigates to `/session/def`
- **THEN** the overlay SHALL be dismissed, since the target is not a route it owns

#### Scenario: An in-overlay switch does not strand a live one-time code

- **GIVEN** a pairing surface holding a one-time code with a live TTL
- **WHEN** its empty state navigates to another page of the same overlay
- **THEN** the code SHALL NOT be discarded by a container remount

#### Scenario: Cold-loaded surface dismisses to its descriptor parent

- **GIVEN** a client navigates directly to `/settings/security` with no tracked in-app predecessor
- **WHEN** the user dismisses the surface
- **THEN** the target SHALL be resolved from the `RouteDescriptor` table
- **AND** the dismissal SHALL NOT be a no-op

#### Scenario: A converted surface still resolves its declared depth

- **WHEN** `routeDepth` is evaluated for `/settings/security` and `/folder/CWD/view?path=README.md`
- **THEN** it SHALL return the same values as before the container swap

#### Scenario: The OpenSpec board stays a full page

- **WHEN** the user navigates to `/folder/CWD/openspec` on a desktop viewport
- **THEN** the kanban board SHALL render as a full page
- **AND** SHALL NOT be constrained to a dialog

#### Scenario: Tunnel setup dismisses back to settings

- **GIVEN** the user opened `/tunnel-setup` from `/settings/gateway`
- **WHEN** the user dismisses the tunnel wizard
- **THEN** the URL SHALL return to `/settings/gateway`
- **AND** the settings surface SHALL render there

#### Scenario: Route-backed surfaces replace rather than stack

- **GIVEN** the user opened `/tunnel-setup` from `/settings/gateway`
- **WHEN** the tunnel surface is rendered
- **THEN** the settings surface SHALL NOT be mounted simultaneously
- **AND** exactly one route-backed overlay SHALL be mounted for the current URL
