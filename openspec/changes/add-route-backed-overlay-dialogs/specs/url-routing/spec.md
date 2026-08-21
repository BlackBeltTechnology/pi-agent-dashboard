## ADDED Requirements

### Requirement: Route-backed overlay container

A converted surface SHALL keep its URL as the addressing contract and SHALL choose its container as a rendering decision independent of that URL. On desktop a converted surface SHALL render in a `Dialog` over a scrim over a pinned background underlay. On mobile it SHALL render inside `MobileShell` at its declared depth.

A matched overlay SHALL NOT render any lower-priority branch **derived from the current location** — session detail, landing, or otherwise. Exactly one branch SHALL be derived from the URL at any time.

The launching route SHALL nevertheless remain visible behind the dialog, rendered as a **pinned background underlay** from a location source independent of `window.location`. The background path SHALL be captured at navigation time and frozen for the overlay's lifetime; on a cold load, where no background was captured, it SHALL be synthesized from `computeBackTarget` of the current route. The underlay SHALL be `aria-hidden`, outside the overlay's focus trap, and non-interactive, and its scroll position SHALL be retained for the overlay's lifetime.

Where the frozen background path ceases to be valid while the overlay is open (its session ended, its folder was removed), the underlay MAY render stale or empty state; dismissal SHALL still navigate to the launching route and resolve through the normal route-matching path.

The guarantee this requirement makes is about **dismissal**, not visibility: dismissing a converted surface SHALL return to the route that launched it.

The following surfaces SHALL be route-backed overlays. Every path below is unchanged by this requirement:

- `/settings/:page?/:sub?`
- `/folder/:cwd/settings/:page`
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

### Requirement: A converted surface SHALL NOT silently discard unsaved edits

A route-backed overlay adds backdrop-click and `Esc` as dismissal gestures that a full-page route never had. When a converted surface holds unsaved edits, a dismissal gesture SHALL NOT discard them silently. The surface SHALL either prompt for confirmation or persist the edit.

#### Scenario: Backdrop click with unsaved edits prompts

- **GIVEN** the settings dialog is open on an editor page with unsaved changes
- **WHEN** the user clicks the backdrop
- **THEN** the user SHALL be prompted before the surface closes
- **AND** the edits SHALL NOT be discarded without that confirmation

#### Scenario: Confirming a discard returns to the launching route, not the card list

- **GIVEN** the user opened the settings surface from `/session/abc` and has unsaved changes
- **WHEN** the user dismisses it and confirms discarding the edits
- **THEN** the URL SHALL return to `/session/abc`
- **AND** SHALL NOT navigate to `/`

#### Scenario: Folder instructions editor is covered by the same guard

- **GIVEN** the user is on `/folder/<encodedCwd>/settings/instructions` with unsaved changes
- **WHEN** the user dismisses the surface via backdrop or `Esc`
- **THEN** the user SHALL be prompted before the surface closes

#### Scenario: Escape with unsaved edits prompts

- **GIVEN** the settings dialog is open on an editor page with unsaved changes
- **WHEN** the user presses `Esc`
- **THEN** the user SHALL be prompted before the surface closes

#### Scenario: Dismissal without unsaved edits does not prompt

- **GIVEN** the settings dialog is open with no unsaved changes
- **WHEN** the user presses `Esc`
- **THEN** the surface SHALL close immediately with no prompt

### Requirement: Converted surfaces SHALL unmount on dismissal

A converted surface SHALL mount lazily when its route matches and SHALL unmount when dismissed. A dismissed overlay SHALL NOT retain live subscriptions, polling, or a mounted heavy grid behind a closed container.

#### Scenario: A dismissed overlay releases its subscriptions

- **GIVEN** a converted surface holding a live subscription is open
- **WHEN** the user dismisses it
- **THEN** the surface SHALL unmount
- **AND** its subscription SHALL be released

## MODIFIED Requirements

### Requirement: Back navigation button
The session header and overlay headers SHALL display a back button. The back action (back button on desktop and mobile, plus the mobile swipe-back gesture) SHALL be **depth-aware**: one back invocation moves exactly one shell depth toward the list, where depth is `getMobileDepth` (0 = list / cards, 1 = detail, 2 = overlay).

Route depth and parent SHALL be resolved from an ordered `RouteDescriptor` table (`{ pattern, depth, computeParent }`), NOT a hardcoded route switch. Resolution SHALL be most-specific-first, first-match-wins. The table SHALL be the union of (a) static descriptors for core routes and (b) descriptors contributed by plugin `shell-overlay-route` claims. `routeDepth(url)` SHALL return the matched descriptor's depth, or 0 when no descriptor matches. A route that resolves to depth 0 is the card list; a route with no matching descriptor SHALL be treated as depth 0.

Modal routes (`/settings`, `/settings/:page`, `/tunnel-setup`) are entered from a launching route and SHALL return to it. The Settings panel and tunnel-setup back affordances SHALL delegate to the shared depth-aware back action; they SHALL NOT hardcode a fixed `/` destination.

The back action SHALL resolve its target as follows:
- When the current route is a modal route AND the app's tracked in-app navigation stack has a predecessor, it SHALL return to the launching route **regardless of the predecessor's depth** (a modal is same-depth with its launcher, so the strictly-shallower fast-path below never fires for it). A single `window.history.back()` satisfies this ONLY when the surface has not pushed history entries of its own; a surface with internal navigation (e.g. the settings panel's page rail) SHALL unwind its own entries so one dismissal leaves the surface entirely rather than stepping back within it.
- It MAY invoke `window.history.back()` as a fast-path ONLY when the app's tracked in-app navigation stack proves the entry it would return to is an in-app route whose depth is strictly shallower than the current depth.
- Otherwise it SHALL navigate explicitly to the computed parent route `computeBackTarget(currentRoute)`, which returns the matched descriptor's `computeParent(...)` result, or the depth default when no `computeParent` is declared:
  - Depth 1 (`/session/:id`, `/folder/:cwd/...`, `/settings`, `/tunnel-setup`, and depth-1 plugin routes) → `/`.
  - A plugin route nested under a `/folder/:cwd` or `/session/:id` parent SHALL NOT be declared `depth: 1`. The history fast-path requires a *strictly shallower* predecessor, so a surface declared at the same depth as its own parent loses the fast-path and falls through to the depth-1 default `/` — ejecting the user from the folder or session it was opened from. Such routes SHALL declare `depth: 2` plus a `parentPath` naming that parent, which resolves correctly on both the in-app and cold-load paths.
  - Depth 2 `/session/:id/diff` → `/session/:id` (strip the `/diff` segment).
  - Depth 2 `/session/:id/editor` → `/session/:id` (internal Monaco editor pane, opened from a file-read preview's "Open").
  - Depth 2 overlays whose URL does not encode their launching detail (`/folder/:cwd/openspec/*`, `/folder/:cwd/pi-resources`, `/pi-resource?…`) → `/`.
  - Depth 2 plugin routes with a declared `parentPath` → that parent (params interpolated from the current match); when the current URL cannot supply a `parentPath` `:param`, `computeParent` SHALL degrade to `/` and the launching route SHALL instead be reached via the tracked-predecessor fast-path. This degradation is a safety net for third-party manifests; bundled plugin claims SHALL declare a `parentPath` their own `path` can satisfy.
  - Depth 0 → no-op.

The back action SHALL NEVER land on a sibling route of the same depth that was not the launching route (e.g. an unrelated `/session/:id`) and SHALL NEVER navigate outside the dashboard application. The app SHALL maintain the tracked navigation stack by appending each navigation (tagged with its derived depth), overwriting the stack top on `replace`-style navigations, and realigning on `popstate`.

The tracker SHALL record navigations regardless of how they are issued — through the app's wrapped `navigate` OR through a component's direct history mutation (a plugin using wouter's raw `useLocation`, a wouter `<Link>`, or session-card routing). To capture the latter, `initNavTracker` SHALL patch `history.pushState`/`replaceState` (composing over any existing patch, e.g. wouter's) so an untracked navigation into a depth-2 plugin overlay still records its shallower launching predecessor, letting the `history.back()` fast-path return there instead of falling back to `/`. The patch SHALL be reverted on teardown and its restore SHALL be idempotent.

#### Scenario: Back from chat returns to cards regardless of prior chats
- **GIVEN** the user navigated `/` → `/session/A` → `/session/B` (both depth 1)
- **AND** the viewport is mobile so `/session/B` renders at depth 1
- **WHEN** the user invokes the depth-aware back action
- **THEN** the URL SHALL resolve to `/` (cards), not to `/session/A`

#### Scenario: Core route depth resolves via the descriptor table
- **GIVEN** the descriptor table migrated from the prior hardcoded switch
- **WHEN** `routeDepth` is evaluated for `/session/abc/diff`, `/folder/CWD/settings/instructions`, and `/folder/CWD/openspec/specs`
- **THEN** it SHALL return `2`, `1`, and `2` respectively, matching pre-migration behavior

#### Scenario: Plugin overlay route resolves to a defined depth (no dead no-op)
- **GIVEN** a plugin `shell-overlay-route` claim declaring `path: "/folder/:encodedCwd/automations"` with `depth: 2` and `parentPath: "/folder/:encodedCwd"`
- **WHEN** the user is on `/folder/CWD/automations` and invokes the depth-aware back action
- **THEN** `routeDepth` SHALL return `2` (not `0`)
- **AND** the back action SHALL resolve to `/folder/CWD` rather than early-returning as a no-op

#### Scenario: A folder-scoped claim declared at depth 1 ejects to the card list
- **GIVEN** a plugin claim declaring `path: "/folder/:encodedCwd/thing"` with `depth: 1`
- **AND** the user reached it from `/folder/CWD` (also depth 1)
- **WHEN** the user invokes the depth-aware back action
- **THEN** the strictly-shallower fast-path SHALL NOT fire
- **AND** the back target SHALL be `/`, demonstrating why such claims declare `depth: 2` with a `parentPath`

#### Scenario: Plugin overlay route with an interpolable parent returns to it
- **GIVEN** a plugin claim declaring `path: "/folder/:encodedCwd/thing/:id"` with `depth: 2` and `parentPath: "/folder/:encodedCwd/thing"`
- **AND** the current URL supplies `:encodedCwd`
- **WHEN** the user invokes the depth-aware back action with no tracked predecessor
- **THEN** `computeParent` SHALL interpolate `:encodedCwd` and navigate to `/folder/<cwd>/thing`

#### Scenario: Core editor overlay backs to its session
- **GIVEN** the user opened the internal editor at `/session/abc/editor?file=AGENTS.md` from a file-read preview
- **WHEN** the user invokes the depth-aware back action
- **THEN** `routeDepth` SHALL return `2`
- **AND** `computeBackTarget` SHALL return `/session/abc`

#### Scenario: Untracked navigation into a plugin overlay is still recorded
- **GIVEN** a component navigates via wouter's raw `useLocation` (a direct `history.pushState`) from `/session/abc` (depth 1) into a depth-2 plugin overlay, bypassing the app's wrapped `navigate`
- **WHEN** the user invokes the depth-aware back action
- **THEN** the tracker (having observed the `pushState`) SHALL expose `/session/abc` as a strictly-shallower predecessor
- **AND** the back action SHALL invoke `window.history.back()` returning to `/session/abc`, NOT navigate to `/`

#### Scenario: Run monitor back returns to its launching route
- **GIVEN** the user opened `/folder/<encoded /Users/u/proj>/automations/run/S` (depth 2) from the board `/folder/<encoded /Users/u/proj>/automations` (depth 2)
- **WHEN** the user invokes the depth-aware back action
- **THEN** the back action SHALL return to the board
- **AND** the back action SHALL NOT land on `/`
- **AND** on a cold load with no tracked predecessor, `computeParent` SHALL interpolate `:encodedCwd` from the run URL and resolve to the board directly
