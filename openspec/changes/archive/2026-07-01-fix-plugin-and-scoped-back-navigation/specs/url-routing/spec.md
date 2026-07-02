## MODIFIED Requirements

### Requirement: Back navigation button
The session header and overlay headers SHALL display a back button. The back action (back button on desktop and mobile, plus the mobile swipe-back gesture) SHALL be **depth-aware**: one back invocation moves exactly one shell depth toward the list, where depth is `getMobileDepth` (0 = list / cards, 1 = detail, 2 = overlay).

Route depth and parent SHALL be resolved from an ordered `RouteDescriptor` table (`{ pattern, depth, computeParent }`), NOT a hardcoded route switch. Resolution SHALL be most-specific-first, first-match-wins. The table SHALL be the union of (a) static descriptors for core routes and (b) descriptors contributed by plugin `shell-overlay-route` claims. `routeDepth(url)` SHALL return the matched descriptor's depth, or 0 when no descriptor matches. A route that resolves to depth 0 is the card list; a route with no matching descriptor SHALL be treated as depth 0.

Modal routes (`/settings`, `/settings/:page`, `/tunnel-setup`) are entered from a launching route and SHALL return to it. The Settings panel and tunnel-setup back affordances SHALL delegate to the shared depth-aware back action; they SHALL NOT hardcode a fixed `/` destination.

The back action SHALL resolve its target as follows:
- When the current route is a modal route AND the app's tracked in-app navigation stack has a predecessor, it SHALL invoke `window.history.back()` so the URL returns to the launching route (regardless of the predecessor's depth).
- It MAY invoke `window.history.back()` as a fast-path ONLY when the app's tracked in-app navigation stack proves the entry it would return to is an in-app route whose depth is strictly shallower than the current depth.
- Otherwise it SHALL navigate explicitly to the computed parent route `computeBackTarget(currentRoute)`, which returns the matched descriptor's `computeParent(...)` result, or the depth default when no `computeParent` is declared:
  - Depth 1 (`/session/:id`, `/folder/:cwd/...`, `/settings`, `/tunnel-setup`, and depth-1 plugin routes) → `/`.
  - Depth 2 `/session/:id/diff` → `/session/:id` (strip the `/diff` segment).
  - Depth 2 `/session/:id/editor` → `/session/:id` (internal Monaco editor pane, opened from a file-read preview's "Open").
  - Depth 2 overlays whose URL does not encode their launching detail (`/folder/:cwd/openspec/*`, `/folder/:cwd/pi-resources`, `/pi-resource?…`, `/automation/run/:sid`) → `/`.
  - Depth 2 plugin routes with a declared `parentPath` → that parent (params interpolated from the current match); when the current URL cannot supply a `parentPath` `:param` (e.g. `/automation/run/:sid` cannot fill `:encodedCwd`), `computeParent` SHALL degrade to `/` and the launching route SHALL instead be reached via the tracked-predecessor fast-path.
  - Depth 0 → no-op.

The back action SHALL NEVER land on a sibling route of the same depth that was not the launching route (e.g. an unrelated `/session/:id`) and SHALL NEVER navigate outside the dashboard application. The app SHALL maintain the tracked navigation stack by appending each navigation (tagged with its derived depth), overwriting the stack top on `replace`-style navigations, and realigning on `popstate`.

The tracker SHALL record navigations regardless of how they are issued — through the app's wrapped `navigate` OR through a component's direct history mutation (a plugin using wouter's raw `useLocation`, a wouter `<Link>`, or session-card routing). To capture the latter, `initNavTracker` SHALL patch `history.pushState`/`replaceState` (composing over any existing patch, e.g. wouter's) so an untracked navigation into a depth-2 plugin overlay (e.g. the automation run monitor, whose `computeParent` degrades to `/`) still records its shallower launching predecessor, letting the `history.back()` fast-path return there instead of falling back to `/`. The patch SHALL be reverted on teardown and its restore SHALL be idempotent.

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
- **GIVEN** a plugin `shell-overlay-route` claim declaring `path: "/folder/:encodedCwd/automations"` with `depth: 1`
- **WHEN** the user is on `/folder/CWD/automations` and invokes the depth-aware back action
- **THEN** `routeDepth` SHALL return `1` (not `0`)
- **AND** the back action SHALL navigate to `/` rather than early-returning as a no-op

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
- **GIVEN** a component navigates via wouter's raw `useLocation` (a direct `history.pushState`) from `/session/abc` (depth 1) into `/automation/run/S` (depth 2), bypassing the app's wrapped `navigate`
- **WHEN** the user invokes the depth-aware back action
- **THEN** the tracker (having observed the `pushState`) SHALL expose `/session/abc` as a strictly-shallower predecessor
- **AND** the back action SHALL invoke `window.history.back()` returning to `/session/abc`, NOT navigate to `/`

#### Scenario: Run monitor back returns to its launching route
- **GIVEN** the user opened `/automation/run/S` (depth 2) from the board `/folder/<encoded /Users/u/proj>/automations` (depth 1)
- **AND** `computeParent` for the run route degrades to `/` because the run URL cannot supply `:encodedCwd`
- **WHEN** the user invokes the depth-aware back action
- **THEN** the tracked shallower predecessor (the board) SHALL be returned to via `window.history.back()`
- **AND** the back action SHALL NOT land on `/`
