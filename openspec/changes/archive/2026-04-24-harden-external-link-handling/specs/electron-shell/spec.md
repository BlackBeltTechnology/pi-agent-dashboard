## ADDED Requirements

### Requirement: External links open in the system browser, not a secondary Electron window
The main `BrowserWindow` created by `createMainWindow` SHALL route every external URL to the user's system browser via `shell.openExternal`, and SHALL never allow an external URL to (a) replace the dashboard in the main window or (b) spawn a secondary Electron `BrowserWindow`. An external URL is any URL whose origin differs from the server origin the main window was loaded with.

This requirement applies to both navigation triggers Electron exposes:
- `target="_blank"` anchors and `window.open` calls (intercepted via `webContents.setWindowOpenHandler`)
- Full-window navigations (intercepted via `webContents.on("will-navigate", ...)`)

Same-origin URLs (including relative paths, in-document fragments, and query-only differences) SHALL continue to navigate normally within the main window so that the dashboard's own routing and the `/auth/login?return=...` redirect flow keep working.

#### Scenario: target=_blank link in dashboard content
- **WHEN** the user clicks an anchor with `target="_blank"` (or JavaScript calls `window.open`) pointing at an external URL
- **THEN** the Electron shell SHALL call `shell.openExternal(url)` and return `{ action: "deny" }` from `setWindowOpenHandler` so no secondary `BrowserWindow` is created

#### Scenario: Bare anchor clicked, external URL
- **WHEN** the user clicks an anchor without `target="_blank"` whose href resolves to a different origin than the server origin
- **THEN** the `will-navigate` handler SHALL call `event.preventDefault()` and `shell.openExternal(url)`
- **AND** the main window SHALL remain on the dashboard

#### Scenario: Same-origin navigation proceeds
- **WHEN** the user (or a client-side redirect) navigates to a same-origin URL such as `/auth/login?return=/`
- **THEN** the `will-navigate` handler SHALL NOT call `event.preventDefault()`
- **AND** the main window SHALL perform the navigation as usual

#### Scenario: Malformed href
- **WHEN** the navigation target cannot be parsed as a URL
- **THEN** the `will-navigate` handler SHALL treat it as external, call `event.preventDefault()`, and delegate to `shell.openExternal` (which the OS / Electron filters by scheme)

### Requirement: Same-origin URL classifier is pure and unit-testable
The classifier used by the Electron shell to decide whether a URL is same-origin as the dashboard SHALL live in a pure module (`packages/electron/src/lib/link-handling.ts`) that performs URL parsing and origin comparison and does NOT import from `electron`. The module SHALL be exercised directly by unit tests without spinning up an Electron process.

#### Scenario: Helper handles relative paths
- **WHEN** `isSameOriginUrl("/settings", "http://localhost:8000")` is called
- **THEN** it SHALL return `true`

#### Scenario: Helper handles absolute URLs with matching origin
- **WHEN** `isSameOriginUrl("http://localhost:8000/auth/login?return=/", "http://localhost:8000")` is called
- **THEN** it SHALL return `true`

#### Scenario: Helper handles absolute URLs with different origin
- **WHEN** `isSameOriginUrl("https://example.com", "http://localhost:8000")` is called
- **THEN** it SHALL return `false`

#### Scenario: Helper handles fragment references
- **WHEN** `isSameOriginUrl("#section", "http://localhost:8000")` is called
- **THEN** it SHALL return `true`

#### Scenario: Helper handles malformed URLs
- **WHEN** `isSameOriginUrl("http:///", "http://localhost:8000")` is called (or any unparseable input)
- **THEN** it SHALL return `false` so the caller treats it as external and routes through `shell.openExternal`
