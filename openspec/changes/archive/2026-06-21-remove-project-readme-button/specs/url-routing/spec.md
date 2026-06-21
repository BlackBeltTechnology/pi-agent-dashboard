## REMOVED Requirements

### Requirement: README preview route
**Reason**: The per-folder README preview button and its `/folder/:encodedCwd/readme` overlay route are retired. README access remains via the editor and filesystem browser. The `/api/readme` endpoint backing this route is also removed.

## MODIFIED Requirements

### Requirement: Back navigation button
The session header and overlay headers SHALL display a back button. The back action (back button on desktop and mobile, plus the mobile swipe-back gesture) SHALL be **depth-aware**: one back invocation moves exactly one shell depth toward the list, where depth is `getMobileDepth` (0 = list / cards, 1 = detail, 2 = overlay).

Modal routes (`/settings`, `/settings/:page`, `/tunnel-setup`) are entered from a launching route and SHALL return to it. The Settings panel and tunnel-setup back affordances SHALL delegate to the shared depth-aware back action; they SHALL NOT hardcode a fixed `/` destination.

The back action SHALL resolve its target as follows:
- When the current route is a modal route AND the app's tracked in-app navigation stack has a predecessor, it SHALL invoke `window.history.back()` so the URL returns to the launching route (regardless of the predecessor's depth).
- It MAY invoke `window.history.back()` as a fast-path ONLY when the app's tracked in-app navigation stack proves the entry it would return to is an in-app route whose depth is strictly shallower than the current depth.
- Otherwise it SHALL navigate explicitly to the computed parent route `computeBackTarget(currentRoute)`:
  - Depth 1 (`/session/:id`, `/folder/:cwd/...`, `/settings`, `/tunnel-setup`) → `/`.
  - Depth 2 `/session/:id/diff` → `/session/:id` (strip the `/diff` segment).
  - Depth 2 overlays whose URL does not encode their launching detail (`/folder/:cwd/openspec/*`, `/folder/:cwd/pi-resources`, `/pi-resource?…`) → `/`.
  - Depth 0 → no-op.

The back action SHALL NEVER land on a sibling route of the same depth that was not the launching route (e.g. an unrelated `/session/:id`) and SHALL NEVER navigate outside the dashboard application. The app SHALL maintain the tracked navigation stack by appending each in-app navigation (tagged with its derived depth), overwriting the stack top on `replace`-style navigations, and realigning on `popstate`.

#### Scenario: Back from chat returns to cards regardless of prior chats
- **GIVEN** the user navigated `/` → `/session/A` → `/session/B` (both depth 1)
- **AND** the viewport is mobile so `/session/B` renders at depth 1
- **WHEN** the user invokes the depth-aware back action
- **THEN** the URL SHALL resolve to `/` (cards), not to `/session/A`

### Requirement: Sidebar interactions push onto browser history
Every sidebar action that opens a shell-owned content-area view (OpenSpec artifact letters, pi-resource links, archive browser, specs browser, file-diff toggle) SHALL invoke `navigate(<route>)` with default push semantics. Replace semantics SHALL NOT be used unless explicitly required for an invalid-URL redirect.

#### Scenario: Sidebar action grows browser history
- **GIVEN** the user is on any URL with `window.history.length === N`
- **WHEN** the user clicks any sidebar action that opens a shell-owned content-area view
- **THEN** `window.history.length` SHALL become `N + 1` (push, not replace)
