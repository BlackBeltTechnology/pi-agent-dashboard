# electron-shell Specification

## Purpose
Defines the Electron desktop shell: main-process lifecycle and bootstrap arms (attach / launch-server / remote), the splash + loading windows, the system tray (ownership-aware menu), the zombie-adoption modal, window state, the opt-in CDP debug surface, and single-instance handling.

## Requirements

### Requirement: Electron main process lifecycle

The Electron main process SHALL discover or launch a dashboard server, then open a BrowserWindow pointing at the server URL. The server SHALL always run as a separate detached process, never in-process. On `ensureServer()` failure the main process SHALL classify the error and route to either the configuration-error dialog or the interactive loading page — it SHALL NOT retry `ensureServer()` a second time, because a second 15 s budget produces no useful signal that the loading page (which polls indefinitely) does not already provide.

#### Scenario: Launch with no server running

- **WHEN** the Electron app starts and no dashboard server is discovered (mDNS via `@blackbelt-technology/pi-dashboard-shared/mdns-discovery` + health check fallback via `@blackbelt-technology/pi-dashboard-shared/server-identity`)
- **THEN** it SHALL launch the server as a detached process using the `tsx` binary and open a BrowserWindow pointing at `http://localhost:<port>` once the server is ready

#### Scenario: Launch with server already running

- **WHEN** the Electron app starts and a localhost dashboard server is discovered
- **THEN** it SHALL skip server launch and open a BrowserWindow pointing at the discovered server URL

#### Scenario: Window close behavior

- **WHEN** the user closes the Electron window
- **THEN** the app SHALL minimize to the system tray (server keeps running)

#### Scenario: Configuration-error failure shows error dialog

- **GIVEN** `ensureServer()` throws an error that does NOT begin with "Server did not respond within" or "Server child process exited prematurely" (e.g. "No TypeScript loader found", "Dashboard server CLI not found", "Port N is in use by another service")
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash and show an error dialog with the failure reason and offer "Run Setup", "Retry", or "Quit" options
- **AND** it SHALL NOT issue a second `ensureServer()` attempt before showing the dialog

#### Scenario: Deadline / child-exit failure falls through to loading page

- **GIVEN** `ensureServer()` throws an error whose message begins with "Server did not respond within" OR "Server child process exited prematurely"
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash, open the BrowserWindow at `http://localhost:<port>`, and call `showLoadingPage(win, serverUrl)`
- **AND** it SHALL NOT show the error dialog
- **AND** it SHALL NOT issue a second `ensureServer()` attempt
- **AND** the loading page SHALL keep polling `/api/health` every 1.5 s, surfacing Start server / Open Doctor / server-log controls after ~15 s as already specified

### Requirement: Loading page with connection retry
The app SHALL show a branded loading page while waiting for the server to become available. The loading page SHALL provide user-initiated controls to launch the server, open Doctor, and view recent server log output once an initial timeout has elapsed.

#### Scenario: Loading page displays
- **WHEN** the BrowserWindow opens before the server is ready
- **THEN** it SHALL show a dark-themed page with the π symbol and "Connecting to dashboard..." animation

#### Scenario: Loading page shows error after timeout
- **WHEN** the server is not available after ~15 seconds
- **THEN** the loading page SHALL show connection error details with installation instructions
- **AND** it SHALL continue retrying in the background and auto-redirect when the server becomes available

#### Scenario: Loading page exposes Start server action after timeout
- **WHEN** the loading page has shown the error state
- **THEN** it SHALL display a primary "Start server" button
- **AND** clicking the button SHALL invoke the main-process `requestServerLaunch()` routine via the `dashboard:request-launch` IPC channel
- **AND** while the launch is in progress, the button SHALL be disabled and the status text SHALL show "Launching server…"

#### Scenario: Loading page reports launch outcome
- **WHEN** `requestServerLaunch()` returns `{ kind: "started" }` or `{ kind: "already-running" }`
- **THEN** the loading page SHALL navigate the BrowserWindow to the server URL within one polling cycle
- **WHEN** `requestServerLaunch()` returns `{ kind: "failed", reason }`
- **THEN** the loading page SHALL re-enable the "Start server" button and display the `reason` string in the status area
- **AND** background polling of `/api/health` SHALL continue so an out-of-band start (e.g. `pi` session, manual `pi-dashboard start`) still auto-redirects

#### Scenario: Loading page exposes Open Doctor action
- **WHEN** the loading page has shown the error state
- **THEN** it SHALL display an "Open Doctor" link
- **AND** clicking the link SHALL send the `dashboard:open-doctor` IPC message which opens the existing Doctor diagnostic window

#### Scenario: Loading page surfaces server log tail
- **WHEN** the loading page has shown the error state
- **AND** `~/.pi/dashboard/server.log` exists and is non-empty
- **THEN** the loading page SHALL show a collapsible "Server log" panel containing the last 20 lines of the log
- **WHEN** the log file does not exist or cannot be read
- **THEN** the panel SHALL be hidden — its absence SHALL NOT block any other loading-page behaviour

#### Scenario: Loading page is loaded from a packaged HTML resource
- **WHEN** the BrowserWindow shows the loading page
- **THEN** it SHALL be loaded via `loadFile('resources/loading.html')` (not a `data:` URL)
- **AND** a preload script SHALL expose only `requestLaunch`, `openDoctor`, `readServerLog`, and `onStatus` on `window.piDashboard` via `contextBridge`

### Requirement: Single-instance lock
The Electron app SHALL use `app.requestSingleInstanceLock()` to prevent multiple Electron windows from running simultaneously.

#### Scenario: Second instance launched
- **WHEN** a second Electron instance is launched
- **THEN** it SHALL focus the existing window and exit the second instance

### Requirement: BrowserWindow configuration
The BrowserWindow SHALL load the dashboard server URL with appropriate settings for a desktop app experience.

#### Scenario: Window opens with dashboard
- **WHEN** the BrowserWindow is created
- **THEN** it SHALL load `http://localhost:<port>` with `nodeIntegration: false`, `contextIsolation: true`, and title "PI Dashboard"
- **AND** it SHALL persist window size and position across restarts

### Requirement: System tray integration
The app SHALL show a system tray icon with a context menu when the window is closed. The tray SHALL use a platform-appropriate icon image. The tray context menu SHALL expose a server-launch action whose label and behaviour reflect current server state.

#### Scenario: Tray icon menu
- **WHEN** the window is minimized to tray
- **THEN** the tray SHALL show a context menu with a server-launch action ("Start server" or "Restart server"), "Show", and "Quit" options

#### Scenario: Tray click reopens window
- **WHEN** the user clicks the tray icon
- **THEN** the window SHALL be shown and focused

#### Scenario: Quit stops server if we started it
- **WHEN** the user clicks "Quit" in the tray menu and Electron started the server
- **THEN** it SHALL stop the server before exiting

#### Scenario: macOS tray uses template image
- **WHEN** the tray is created on macOS
- **THEN** it SHALL load `trayTemplate.png` from the resources directory (auto-adapts to dark/light menu bar)

#### Scenario: Windows/Linux tray uses app icon
- **WHEN** the tray is created on Windows or Linux
- **THEN** it SHALL load `icon.ico` or `icon.png` from the resources directory

#### Scenario: Tray shows Start server when no server is running
- **WHEN** the tray menu is rebuilt and `isDashboardRunning(port)` returns `false`
- **THEN** the menu SHALL show a "Start server" item
- **AND** clicking it SHALL call `requestServerLaunch()` and update tray status when the outcome resolves

#### Scenario: Tray shows Restart server when a server is running
- **WHEN** the tray menu is rebuilt and `isDashboardRunning(port)` returns `true`
- **THEN** the menu SHALL show a "Restart server" item
- **AND** clicking it SHALL call `requestServerLaunch({ force: true })`

#### Scenario: Tray menu reflects state changes within 5 seconds
- **WHEN** server state changes (started or stopped) while the app is running
- **THEN** the tray menu SHALL be rebuilt within 5 seconds to reflect the new state

### Requirement: macOS application menu
The Electron app SHALL set up a native macOS application menu with standard menu items.

#### Scenario: App menu structure on macOS
- **WHEN** the app starts on macOS
- **THEN** the application menu SHALL include: App name menu (About, Doctor, Separator, Quit), Edit (Undo, Cut, Copy, Paste, Select All), View (Reload, Toggle DevTools), Window (Minimize, Close)

#### Scenario: About dialog
- **WHEN** the user selects "About PI Dashboard" from the app menu
- **THEN** a native dialog SHALL display the app name, version number (from `app.getVersion()`), and copyright text

#### Scenario: App menu on Windows/Linux
- **WHEN** the app starts on Windows or Linux
- **THEN** a minimal Help menu SHALL be set with "Doctor..." and "About" items

### Requirement: Doctor diagnostic function
The app SHALL provide a Doctor function accessible from the app menu that checks all required components and renders the result in a dedicated styled BrowserWindow (not a native message-box dialog).

#### Scenario: Doctor checks all components
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** it SHALL check: Electron version, system Node.js, bundled Node.js, bundled npm, pi CLI, openspec CLI, dashboard server code, offline packages bundle, TypeScript loader (tsx), dashboard server status, server log presence, server launch test, setup wizard state, API key configuration, and managed install directory
- **AND** each check SHALL report status (ok/warning/error), version, path, the section it belongs to, and a remediation suggestion when the status is not ok

#### Scenario: Doctor opens a styled window
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** the app SHALL open a dedicated BrowserWindow rendering the report grouped by section, with a per-row status pill, message, optional path, and optional suggestion
- **AND** the window SHALL provide toolbar actions: Re-run, Copy as Markdown, Copy as Plain text, Open server log, Open doctor log, Run setup wizard
- **AND** opening Doctor while the window is already open SHALL focus the existing window instead of creating a second one

#### Scenario: Doctor offers setup for errors
- **WHEN** the Doctor report contains fixable errors
- **THEN** the window SHALL surface a "Run setup wizard" toolbar action that triggers the setup wizard

### Requirement: VM GPU detection
The app SHALL auto-detect virtual machine environments and disable GPU acceleration to prevent white screen rendering issues.

#### Scenario: VMware detection on macOS
- **WHEN** the app starts on macOS and `sysctl -n hw.model` contains "VMware", "VirtualBox", or "Parallels"
- **THEN** it SHALL call `app.disableHardwareAcceleration()` and append `--disable-gpu` switch

#### Scenario: VM detection on Linux
- **WHEN** the app starts on Linux and `systemd-detect-virt` returns a non-"none" value
- **THEN** it SHALL disable hardware acceleration

#### Scenario: Manual GPU disable
- **WHEN** the `ELECTRON_DISABLE_GPU` environment variable is set
- **THEN** it SHALL disable hardware acceleration regardless of platform

### Requirement: Dev mode for Electron
When the `ELECTRON_DEV` environment variable is set, the Electron app SHALL connect to an externally running server without launching one, enabling the existing dev workflow.

#### Scenario: Dev mode skips server launch
- **WHEN** `ELECTRON_DEV=1` is set
- **THEN** the Electron app SHALL open a BrowserWindow pointing at `http://localhost:8000` with the loading page retry mechanism

### Requirement: Server launch via tsx binary
The server SHALL be launched using the `tsx` binary (not `node --import tsx/esm`) to ensure proper `__dirname`/`__filename` shimming for CJS dependencies. When `tsx` is not available, the server SHALL fall back to spawning `node` with a `jiti` ESM loader; the jiti loader SHALL be resolved via the existing `resolveJitiFromPi()` chain (managed install first, then system pi). The bundled server tree (`resources/server/node_modules/`) does NOT contain `pi-coding-agent` and SHALL NOT be a candidate in the resolution chain — the runtime model is "tsx and pi live in the managed dir; the bundled tree only contains workspace deps."

#### Scenario: tsx binary resolution
- **WHEN** the server needs to be launched
- **THEN** it SHALL find the `tsx` binary in `~/.pi-dashboard/node_modules/.bin/tsx` (managed) or system PATH

#### Scenario: Server launch with tsx
- **WHEN** launching the server
- **THEN** it SHALL spawn `tsx <cli.ts> --port <port> --pi-port <piPort>` with NODE_PATH including the bundled server's node_modules

#### Scenario: Server launch logging
- **WHEN** the server is launched
- **THEN** it SHALL write launch diagnostics and server output to `~/.pi-dashboard/server.log`

#### Scenario: jiti fallback uses managed install first
- **WHEN** `tsx` is not found
- **THEN** the jiti loader passed to `node --import` SHALL be resolved from `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent` (managed install) BEFORE checking the system pi install
- **AND** the resolver SHALL NOT check the bundled server's `node_modules` (which intentionally does not contain pi-coding-agent — see the `electron-build-pipeline` spec)
### Requirement: External links open in the system browser, not a secondary Electron window
The main `BrowserWindow` created by `createMainWindow` SHALL route every external URL initiated **from the dashboard origin** to the user's system browser via `shell.openExternal`, and SHALL never allow an external URL to (a) replace the dashboard in the main window or (b) spawn a secondary Electron `BrowserWindow`. An external URL is any URL whose origin differs from the server origin the main window was loaded with.

This requirement applies to both navigation triggers Electron exposes:
- `target="_blank"` anchors and `window.open` calls (intercepted via `webContents.setWindowOpenHandler`) — routed through `shell.openExternal` regardless of which page issued the call (correct for both chat-content links and OAuth device-code verification URIs).
- Full-window navigations (intercepted via `webContents.on("will-navigate", ...)`) — the decision is **current-origin-aware**: only navigations that *leave the dashboard* are intercepted. Navigation that originates from a non-dashboard page (e.g. an OAuth provider's login flow currently displayed in the BrowserWindow) SHALL proceed without interception so multi-step authentication can complete.

Same-origin URLs (including relative paths, in-document fragments, and query-only differences) SHALL continue to navigate normally within the main window so that the dashboard's own routing and the `/auth/login?return=...` redirect flow keep working.

#### Scenario: target=_blank link in dashboard content
- **WHEN** the user clicks an anchor with `target="_blank"` (or JavaScript calls `window.open`) pointing at an external URL
- **THEN** the Electron shell SHALL call `shell.openExternal(url)` and return `{ action: "deny" }` from `setWindowOpenHandler` so no secondary `BrowserWindow` is created

#### Scenario: Bare anchor clicked, external URL (when on the dashboard)
- **WHEN** the user clicks an anchor without `target="_blank"` whose href resolves to a different origin than the server origin
- **AND** `webContents.getURL()` returns a URL whose origin equals the captured server origin (the user is currently on the dashboard)
- **THEN** the `will-navigate` handler SHALL call `event.preventDefault()` and `shell.openExternal(url)`
- **AND** the main window SHALL remain on the dashboard

#### Scenario: Same-origin navigation proceeds
- **WHEN** the user (or a client-side redirect) navigates to a same-origin URL such as `/auth/login?return=/`
- **THEN** the `will-navigate` handler SHALL NOT call `event.preventDefault()`
- **AND** the main window SHALL perform the navigation as usual

#### Scenario: Malformed href
- **WHEN** the navigation target cannot be parsed as a URL
- **THEN** the `will-navigate` handler SHALL treat it as if `decideWillNavigate` returned `"open-external"` (i.e. `event.preventDefault()` plus `shell.openExternal(url)`, which the OS / Electron filters by scheme)

#### Scenario: Mid-flight OAuth / OIDC navigation is not intercepted
- **WHEN** `webContents` emits `will-navigate` AND `webContents.getURL()` returns a URL whose origin is **not** the dashboard origin (e.g. the user is mid-login on `accounts.google.com`, `github.com`, `login.microsoftonline.com`, or any OAuth provider that the dashboard's `/auth/start/:provider` redirected them to)
- **THEN** the guard SHALL allow the navigation to proceed unchanged — it SHALL NOT call `event.preventDefault()` and SHALL NOT call `shell.openExternal`
- **AND** this includes provider-internal navigation (provider → provider), provider → dashboard callback redirects (`provider → http://<dashboard>/auth/callback/...`), and provider → third-party identity-broker navigations
- **AND** the eventual redirect back to the dashboard origin SHALL land in the BrowserWindow normally; no special handling is required because the resulting `will-navigate` (if it fires) is itself same-origin under the dashboard branch

#### Scenario: Same-origin SPA navigation unaffected
- **WHEN** the React app performs a `pushState` or hash route change within the dashboard origin
- **THEN** `will-navigate` SHALL NOT fire and the navigation SHALL succeed (this is Electron's documented behavior for `will-navigate`; the guard does not need to special-case it)

#### Scenario: will-navigate decision helper exists and is unit-tested
- **WHEN** a developer needs to decide whether a `will-navigate` event should be allowed, intercepted, or cancelled
- **THEN** they SHALL use the pure helper `decideWillNavigate(serverOrigin, currentUrl, targetUrl) → "allow" | "open-external" | "cancel"` exported from `packages/electron/src/lib/link-handling.ts`
- **AND** that helper SHALL be covered by unit tests for: same-origin navigation on the dashboard (allow), external target on the dashboard (open-external), provider-internal navigation while not on the dashboard (allow), provider → dashboard callback (allow), provider → third-party identity broker (allow), unparseable current URL (fall back to leaving-dashboard rules), unparseable server origin (fail closed → cancel)

#### Scenario: Decision helper fail-closes on unparseable server origin
- **WHEN** `decideWillNavigate` is called with a `serverOrigin` argument that cannot be parsed as a URL
- **THEN** the helper SHALL return `"cancel"` (the caller MUST `event.preventDefault()` without opening anything externally)
- **AND** this protects against a configuration error in `serverUrl` from accidentally allowing arbitrary external navigation

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

### Requirement: Server-startup deadline is 15 seconds with cause-aware error wording

The `waitForReady` callsites in `server-lifecycle.ts` SHALL use a deadline of `15_000` milliseconds (15 seconds), not `60_000`. The error message constructed when `waitForReady` returns unsuccessful SHALL distinguish two cases — child process exiting prematurely vs. deadline elapsed without the probe returning true — and use different wording for each. The deadline budget SHALL NOT exceed 15 s because beyond that point the failure is almost always terminal (port conflict, missing loader, bad Node) and the loading page (`resources/loading.html`) is a strictly better surface — it polls every 1.5 s and exposes Start server / Open Doctor / log-tail controls — than a frozen splash.

#### Scenario: Deadline is 15 seconds at every callsite

- **WHEN** `server-lifecycle.ts` is parsed
- **THEN** every `waitForReady` call SHALL pass `deadlineMs: SERVER_READY_DEADLINE_MS`
- **AND** `SERVER_READY_DEADLINE_MS` SHALL be `15_000`

#### Scenario: Child-exit error wording

- **WHEN** the spawned server child process exits before the probe returns true
- **THEN** the thrown error SHALL begin with "Server child process exited prematurely (...)"
- **AND** SHALL include a hint identifying the typical cause ("usually means a missing dependency or wrong TypeScript loader")
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

#### Scenario: Deadline-exceeded error wording

- **WHEN** the deadline elapses without either the probe returning true or the child exiting
- **THEN** the thrown error SHALL begin with "Server did not respond within 15 seconds (...)"
- **AND** SHALL include the hint "The server is likely still starting; the loading page will keep polling — try the Doctor button if it doesn't connect"
- **AND** SHALL include the spawn command, CWD, and the last 20 lines of `server.log`

### Requirement: Power-user mode runs `installStandalone()` even when the wizard UI is skipped
The Electron main-process startup logic in `packages/electron/src/main.ts` SHALL run `installStandalone()` (or its dependency-installer equivalent) on every first launch, regardless of whether the wizard UI is shown. The current "auto-skip wizard when `pi.found && bridge.found`" optimisation SHALL be limited to suppressing the *user-facing wizard window*; it SHALL NOT skip the *managed dependency install*.

The two concerns are orthogonal:
- *Show wizard UI?* — depends on user state (skip if pi+bridge already present)
- *Install managed dependencies?* — should ALWAYS run on first launch (the bundled server's runtime requires `tsx`/`pi-coding-agent`/`openspec` to be in the managed dir, NOT in the user's system pi)

Conflating them produced Defect 1 of change `fix-electron-windows-installer-and-server-bootstrap`: the user's `~/.pi-dashboard/node_modules/` stayed empty after the auto-skip path, so the bundled server had no `tsx` / `pi-coding-agent` / `openspec` to load and crashed with `MODULE_NOT_FOUND` (after falling back to system pi 0.71.x's broken jiti).

#### Scenario: Power-user first launch installs managed dependencies
- **WHEN** the Electron app launches for the first time AND `pi.found && bridge.found` evaluates to true
- **THEN** the wizard UI SHALL NOT be shown (preserves the existing optimisation)
- **AND** `installStandalone()` SHALL be called and complete (or fail loudly with a user-visible error)
- **AND** `~/.pi-dashboard/node_modules/` SHALL contain `tsx`, `@mariozechner/pi-coding-agent` at the pinned version, and `@fission-ai/openspec` at the pinned version after the install completes

#### Scenario: Subsequent launches in power-user mode are fast
- **WHEN** the Electron app launches for the second or later time in power-user mode AND `~/.pi-dashboard/node_modules/` is already populated with the expected packages at the expected versions
- **THEN** `installStandalone()` SHALL detect the populated state and return immediately (idempotency check)
- **AND** the launch SHALL not be measurably slower than today's auto-skip path

#### Scenario: Wizard UI path also runs install
- **WHEN** the Electron app launches for the first time AND either pi or bridge is missing (so the wizard UI IS shown)
- **THEN** the wizard SHALL run `installStandalone()` as part of its existing flow (preserves current behaviour)

#### Scenario: Power-user mode + corrupt managed dir re-installs
- **WHEN** the Electron app launches in power-user mode AND `~/.pi-dashboard/node_modules/` exists but is missing one or more pinned packages
- **THEN** `installStandalone()` SHALL detect the partial state and re-install the missing packages

#### Scenario: Loading page shows install progress
- **WHEN** `installStandalone()` is running during the auto-skip path's first launch
- **THEN** the Electron main window's loading page SHALL display a "Setting up dependencies..." indicator
- **AND** the indicator SHALL switch to "Connecting to server..." once `installStandalone()` completes and the server-launch step begins

### Requirement: `detectPiDashboardCli()` filters for executable extensions on Windows
On Windows, `detectPiDashboardCli()` in `packages/electron/src/lib/dependency-detector.ts` SHALL filter the output of `where pi-dashboard` for files with one of the executable extensions `.cmd`, `.exe`, `.bat`, `.ps1` (case-insensitive) and prefer the first such match. This SHALL fall back to `lines[0]` only when no candidate has a recognised executable extension. POSIX behaviour (single line from `which`) SHALL be unchanged.

This requirement exists because npm-global installs on Windows produce both an extensionless POSIX shim AND a `.cmd` shim for each binary; `where` returns both lines; `lines[0]` is the extensionless one; `spawn(path, args, { shell: false })` cannot invoke an extensionless shim on Windows and produces `ENOENT`. Filtering for executable extensions ensures we always pick the spawnable candidate.

#### Scenario: Windows picks `.cmd` over extensionless shim
- **WHEN** `where pi-dashboard` returns multiple lines on Windows including both an extensionless shim AND a `.cmd` shim
- **THEN** `detectPiDashboardCli()` SHALL return the path ending in `.cmd`

#### Scenario: Windows picks `.exe` when present
- **WHEN** `where pi-dashboard` returns a `.exe` candidate alongside the extensionless and `.cmd` shims
- **THEN** the function SHALL return any of the executable-extension matches (the order among `.cmd` / `.exe` / `.bat` / `.ps1` is implementation-defined; the requirement is that it NOT be the extensionless one)

#### Scenario: POSIX behaviour unchanged
- **WHEN** the function runs on Linux or macOS (`process.platform !== "win32"`)
- **THEN** it SHALL return the first line of `which pi-dashboard` regardless of extension (POSIX has no `where` and no extensionless-shim concern)

#### Scenario: No executable extension found, fall back to lines[0]
- **WHEN** `where pi-dashboard` returns multiple lines on Windows AND none have a recognised executable extension
- **THEN** the function SHALL return `lines[0]` (preserves the current behaviour for unusual setups; the spawn site fails loudly there if needed)

### Requirement: `shouldUrlWrapEntry()` documents jiti version contract
The `shouldUrlWrapEntry()` helper in `packages/shared/src/platform/node-spawn.ts` SHALL include a documented contract in its header comment that the Windows-non-tsx arm assumes the jiti loader is from `@mariozechner/pi-coding-agent@0.70.x` (jiti 2.x with the `file:///` triple-slash URL handling fix). The contract SHALL explicitly note that newer jiti versions (e.g. jiti 2.6.5 in pi-coding-agent@0.71.x) misnormalize triple-slash URLs and break the contract. The contract SHALL also direct future contributors to either update the contract, add a per-version branch, or switch to tsx if the offline-cacache-pinned `pi-coding-agent` is ever bumped to a version with a different jiti.

The contract is **defended in practice** by Defect 1's fix: when `installStandalone()` runs from the offline cacache, the managed dir contains `pi-coding-agent` at the version pinned in `packages/electron/offline-packages.json` (currently `0.70.0`). The runtime resolver `resolveJitiFromPi()` finds the managed version first; the system fallback (which is where jiti 2.6.5 would come from on a user's machine) is only reached when the managed dir is empty — which after Defect 1's fix should never happen.

The contract SHALL be regression-pinned by an automated test that asserts the offline-cacache-pinned `pi-coding-agent` version falls within the supported range (`0.70.x`).

#### Scenario: Header comment documents the version contract
- **WHEN** `packages/shared/src/platform/node-spawn.ts` is read
- **THEN** the `shouldUrlWrapEntry` function's header comment SHALL contain the strings "jiti version contract" and "0.70.x"
- **AND** SHALL contain at least one of the strings "0.71" / "2.6.5" identifying the known-broken jiti version
- **AND** SHALL contain remediation guidance (re-verify, add per-version branch, OR switch to tsx)

#### Scenario: Test asserts offline-cacache pi version is in the supported range
- **WHEN** the regression-pin test (`node-spawn-jiti-contract.test.ts`) runs
- **THEN** it SHALL read the `@mariozechner/pi-coding-agent` pin from `packages/electron/offline-packages.json`
- **AND** SHALL fail if the version does not begin with `0.70.` (i.e. is not within the contract-supported range)

### Requirement: Extracted LaunchSource health-checks jiti reachability before returning
The `extracted` LaunchSource resolution path SHALL verify that the bundled CLI tree is usable before returning. Specifically, `extractLaunchSource` SHALL compute `healthy = existsSync(cliPath) && resolveJitiFromAnchor(cliPath) !== null` after the version-marker check and SHALL run the bundle extraction + `installStandalone` block when `healthy` is `false`, even if the `.version` marker matches `currentVersion`. The current behavior — relying on the marker alone — is insufficient because the marker can be stale relative to the actual node_modules tree (partial extraction, antivirus quarantine, manual wipe, npm reconciliation prune).

#### Scenario: Marker matches and jiti reachable — skip extraction
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches `bundledMinVersion` AND `cliPath` exists AND `resolveJitiFromAnchor(cliPath)` returns a non-null URL
- **THEN** the function SHALL skip extraction (`didExtract: false`)
- **AND** the returned `LaunchSource` SHALL be `{ kind: "extracted", cliPath, cwd: managedDir, didExtract: false }`

#### Scenario: Marker matches but cliPath missing — re-extract
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches `bundledMinVersion` BUT `cliPath` does not exist on disk
- **THEN** the function SHALL run `extractBundle` followed by `installStandalone` (the same block triggered by `needsExtraction`)
- **AND** the returned `LaunchSource` SHALL reflect that re-extraction occurred

#### Scenario: Marker matches and cliPath exists but jiti unreachable — re-extract
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches AND `cliPath` exists BUT `resolveJitiFromAnchor(cliPath)` returns `null`
- **THEN** the function SHALL run `extractBundle` followed by `installStandalone`
- **AND** SHALL log a single warn line `[launch-source] extracted source unhealthy (jiti missing); forcing re-extract` before doing so

#### Scenario: Marker mismatch — re-extract regardless of health
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker does NOT match `bundledMinVersion`
- **THEN** the function SHALL run `extractBundle` + `installStandalone` (existing behavior — health check is additive, not subtractive)

#### Scenario: Health probe accepts injected dependencies for testing
- **WHEN** `extractedSourceIsHealthy(cliPath, deps?)` is called from a unit test with `deps = { existsSync, resolveJitiFromAnchor }` mocked
- **THEN** the helper SHALL use the injected functions and SHALL NOT touch the real filesystem or invoke the real jiti resolver

#### Scenario: Health probe is defensive against thrown errors
- **WHEN** an injected `existsSync` or `resolveJitiFromAnchor` throws
- **THEN** `extractedSourceIsHealthy` SHALL return `false` (treating thrown errors as unhealthy)

### Requirement: Idempotent server launch routine
The Electron main process SHALL expose an exported `requestServerLaunch()` routine in `packages/electron/src/lib/server-lifecycle.ts` that is the single entry point used by the loading page button, tray menu items, and any future in-app launch controls. The routine SHALL be idempotent under concurrent invocation.

#### Scenario: Returns already-running when server responds
- **WHEN** `requestServerLaunch()` is called with `force: false` (or omitted)
- **AND** `isDashboardRunning(port)` returns `true`
- **THEN** it SHALL return `{ kind: "already-running", url }` without spawning a new process

#### Scenario: Spawns server when none running
- **WHEN** `requestServerLaunch()` is called and no server is running
- **THEN** it SHALL invoke the existing server-spawn path (same code as startup `ensureServer()`)
- **AND** on success return `{ kind: "started", url }`
- **AND** on failure return `{ kind: "failed", reason, logTail }` — never throw

#### Scenario: Force restart when server already running
- **WHEN** `requestServerLaunch({ force: true })` is called and a server is running
- **THEN** it SHALL POST `/api/shutdown` to stop the running server
- **AND** wait (up to 5 seconds) for `isDashboardRunning(port)` to return `false`
- **AND** then invoke the standard spawn path and return `{ kind: "started", url }`
- **AND** if the shutdown POST fails, fall through to the spawn path anyway (which will fail with a clear `EADDRINUSE` error captured in the `failed` outcome)

#### Scenario: Concurrent calls share one launch attempt
- **WHEN** two callers invoke `requestServerLaunch()` while a launch is already in flight
- **THEN** both callers SHALL receive the same `LaunchOutcome` from a single underlying spawn
- **AND** at most one server process SHALL be spawned

#### Scenario: Failure outcome is a value, not an exception
- **WHEN** the spawn step throws synchronously or the spawned process exits non-zero before becoming healthy
- **THEN** `requestServerLaunch()` SHALL catch the error and return `{ kind: "failed", reason: <string>, logTail: <string> }`
- **AND** SHALL NOT propagate the exception to the caller

### Requirement: Electron IPC channels for server control
The Electron main process SHALL register IPC handlers for renderer-initiated server control. All channels SHALL be prefixed `dashboard:` and gated to the loading-page renderer's preload origin.

#### Scenario: dashboard:request-launch handler
- **WHEN** the renderer invokes `dashboard:request-launch` with payload `{ force?: boolean }`
- **THEN** the main process SHALL call `requestServerLaunch(payload)` and return the resolved `LaunchOutcome`

#### Scenario: dashboard:open-doctor handler
- **WHEN** the renderer sends `dashboard:open-doctor`
- **THEN** the main process SHALL open the existing Doctor diagnostic window (same path as the app menu's Doctor item)

#### Scenario: dashboard:read-server-log handler
- **WHEN** the renderer invokes `dashboard:read-server-log` with payload `{ lines?: number }` (default 20)
- **THEN** the main process SHALL return up to `lines` trailing lines of `~/.pi/dashboard/server.log`
- **AND** SHALL return an empty string if the file does not exist or cannot be read
- **AND** SHALL read at most 8 KiB from the tail to bound memory

#### Scenario: dashboard:launch-status push events
- **WHEN** a launch is in progress
- **THEN** the main process SHALL emit `dashboard:launch-status` events with payload `{ phase: "starting" | "spawning" | "waiting-health" | "ready" | "failed", message?: string }` to the loading-page renderer
- **AND** the loading-page preload SHALL expose `onStatus(cb)` returning an unsubscribe function

### Requirement: Splash window appears immediately on app launch

The Electron main process SHALL create a splash window as the first action inside `app.whenReady()`, before any dependency detection, module resolution, or server launch work. The splash window SHALL be frameless, transparent, centered, alwaysOnTop, and non-resizable. It SHALL display a visual identity (pi logo + app name), a CSS spinner animation, and a status text line.

#### Scenario: Cold launch on Windows shows splash within 1 second

- **GIVEN** a Windows user double-clicks the packaged pi-dashboard executable on a cold-cached disk
- **WHEN** `app.whenReady()` resolves
- **THEN** a splash window SHALL appear within 1 second
- **AND** the splash SHALL be visible continuously until the next intended window (wizard or main) is ready to show
- **AND** no user action SHALL be required to dismiss it

#### Scenario: Failed splash render does not block startup

- **GIVEN** the splash window fails to create or render (e.g. GPU crash)
- **WHEN** the error is caught in `app.whenReady()`
- **THEN** the error SHALL be logged
- **AND** the main process SHALL continue to open the wizard or main window as normal

### Requirement: Status messages progress through detection phases

The splash window SHALL receive status updates from the main process via a `updateSplashStatus(text)` helper that writes to the splash `webContents` (current implementation: `webContents.executeJavaScript()` mutating the inline `<div id="status">`). The main process SHALL emit a status update before each detection phase and before each window-transition phase.

#### Scenario: Each detection phase emits a status update

- **GIVEN** the main process runs dependency detection
- **WHEN** it invokes server health-check, `detectPi()`, bridge-extension check, wizard open, server launch, or dashboard open
- **THEN** a corresponding status update SHALL be sent to the splash window before that call
- **AND** the status text SHALL be user-readable (e.g. "Checking Node.js…", not "detectSystemNode()")

### Requirement: Splash closes when the next window is ready

When the main process creates a wizard or main window, it SHALL close the splash only after the target window's `ready-to-show` event fires (or equivalent readiness signal). This prevents a visible gap between splash and next window.

#### Scenario: Splash closes after main window is ready

- **GIVEN** splash is visible and main window is being created
- **WHEN** the main window emits `ready-to-show`
- **THEN** the splash window SHALL close
- **AND** the main window SHALL be shown in the same animation frame (no black flash)

#### Scenario: Splash closes after wizard window is ready

- **GIVEN** splash is visible and dependencies are missing, so the wizard is being created
- **WHEN** the wizard window emits `ready-to-show`
- **THEN** the splash window SHALL close
- **AND** the wizard window SHALL be shown

### Requirement: Opt-in CDP debug surface

The Electron main process SHALL accept an opt-in activation that exposes Chromium's Chrome DevTools Protocol (CDP) on a loopback port for the lifetime of the app instance. Activation SHALL require an explicit CLI flag (`--debug-cdp[=<port>]`) or environment variable (`PI_DEBUG_CDP=<value>`). Default behavior with no flag and no env var SHALL be CDP-disabled.

The activated port SHALL default to `9222`. A non-default port MAY be supplied via `--debug-cdp=<port>` or `PI_DEBUG_CDP=<port>`. When `PI_DEBUG_CDP=1` (truthy non-port value) is supplied without an explicit port, the default `9222` SHALL apply. When both CLI flag and env var are present, the CLI flag SHALL take precedence.

When activated, the main process SHALL append Chromium's `remote-debugging-port` command-line switch via `app.commandLine.appendSwitch('remote-debugging-port', <port>)` before any code path that materializes Chromium state (specifically: before `app.whenReady()` resolves and before the first `BrowserWindow` is created).

The main process SHALL NOT append `remote-debugging-address`. Chromium's default loopback (`127.0.0.1`) binding SHALL apply, restricting CDP to local clients.

#### Scenario: Default — CDP disabled

- **WHEN** the Electron app is launched without `--debug-cdp` and without `PI_DEBUG_CDP` set
- **THEN** Chromium SHALL NOT expose any CDP HTTP endpoint
- **AND** `app.commandLine.hasSwitch('remote-debugging-port')` SHALL return `false`

#### Scenario: CLI flag with default port

- **WHEN** the Electron app is launched with `--debug-cdp` (no `=<port>`)
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9222')` before `app.whenReady()`

#### Scenario: CLI flag with explicit port

- **WHEN** the Electron app is launched with `--debug-cdp=9333`
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9333')`

#### Scenario: Env var activates default port

- **WHEN** the Electron app is launched with `PI_DEBUG_CDP=1` and no CLI flag
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9222')`

#### Scenario: Env var supplies explicit port

- **WHEN** the Electron app is launched with `PI_DEBUG_CDP=9444` and no CLI flag
- **THEN** the main process SHALL call `app.commandLine.appendSwitch('remote-debugging-port', '9444')`

#### Scenario: CLI flag overrides env var

- **WHEN** the Electron app is launched with both `--debug-cdp=9555` and `PI_DEBUG_CDP=9777`
- **THEN** the main process SHALL use port `9555`

#### Scenario: Never binds promiscuously

- **WHEN** CDP is activated by any means
- **THEN** the main process SHALL NOT call `app.commandLine.appendSwitch('remote-debugging-address', ...)`
- **AND** there SHALL be no CLI flag, env var, or config field that causes such an append to occur

### Requirement: Activation logs a warning

When CDP is activated, the main process SHALL log a single-line warning to stderr at startup making the activation visible to the user. The warning SHALL include the port number and indicate that local automation is enabled.

#### Scenario: Warning emitted on activation

- **WHEN** the Electron app is launched with CDP activated
- **THEN** stderr SHALL contain a log line matching the form `[debug-cdp] CDP listening on :<port> — local automation is enabled` (or equivalent prose with the same elements: tag, port, intent)

#### Scenario: No warning when disabled

- **WHEN** the Electron app is launched without CDP activation
- **THEN** stderr SHALL NOT contain any `[debug-cdp]` log line

### Requirement: Single-instance-lock interaction

The CDP debug surface SHALL be enabled only at first-instance launch. The dashboard's existing single-instance lock SHALL continue to apply: a second launch with `--debug-cdp` (or `PI_DEBUG_CDP`) while a first instance is already running SHALL NOT retroactively enable CDP on the first instance.

When the single-instance second-instance hook is invoked with `--debug-cdp` present in the second instance's argv and the first instance was launched without CDP, the first instance SHALL log a single warning line to its stderr explaining that CDP enablement requires fully quitting and relaunching.

#### Scenario: Second launch with flag against running app

- **WHEN** a first instance is running without CDP and a second launch is invoked with `--debug-cdp`
- **THEN** the second-instance hook SHALL log a warning to the first instance's stderr indicating that CDP cannot be enabled retroactively
- **AND** the first instance SHALL NOT open a CDP port
- **AND** the second-instance process SHALL exit normally (per existing single-instance behavior)

#### Scenario: Second launch without flag against CDP-enabled app

- **WHEN** a first instance is running with CDP enabled and a second launch is invoked without `--debug-cdp`
- **THEN** behavior SHALL be unchanged from existing single-instance handling
- **AND** the first instance's CDP port SHALL remain open

### Requirement: Tray menu reflects server ownership

The Electron tray menu's primary action SHALL be derived from a three-way ownership classification — `"electron" | "foreign" | "none" | "unknown"` — rather than a binary `isRunning` flag. The classifier SHALL consult both `/api/health.launchSourceEffective` and the Electron-process-local `storedSpawnedPid`.

- `"electron"` (server reachable AND `launchSourceEffective === "electron"` AND `pid === storedSpawnedPid`) → menu first item SHALL be **Restart server**, enabled, click invokes `onLaunch(true)`.
- `"none"` (server unreachable) → menu first item SHALL be **Start server**, enabled, click invokes `onLaunch(false)`.
- `"foreign"` (server reachable AND ownership does not match) → menu first item SHALL be a disabled informational row labelled **Server managed externally** with no click handler.
- `"unknown"` (probe error) → no launch item rendered (current `null` behaviour preserved).

The tray polling probe SHALL re-evaluate ownership every 3 seconds and rebuild the menu only when the value changes from the prior poll.

#### Scenario: Foreign server suppresses Restart action

- **GIVEN** the user is running `pi-dashboard start` from a terminal
- **WHEN** the Electron app launches AND opens the tray menu
- **THEN** the menu SHALL NOT contain a "Restart server" item
- **AND** SHALL contain a disabled "Server managed externally" row

#### Scenario: Electron-owned server shows Restart

- **GIVEN** Electron spawned the dashboard server on launch
- **WHEN** the user opens the tray menu
- **THEN** the menu SHALL contain an enabled "Restart server" item

#### Scenario: No server shows Start

- **GIVEN** no dashboard server is running on the configured port
- **WHEN** the user opens the tray menu
- **THEN** the menu SHALL contain an enabled "Start server" item

#### Scenario: Probe error omits launch item

- **WHEN** the ownership probe fails (network error or non-200 response)
- **THEN** the menu SHALL NOT contain any Start/Restart/managed-externally item
- **AND** the Show/Quit items SHALL still be present

### Requirement: Zombie server adoption modal (cross-platform)

When the Electron app launches and takes the `attach` arm of the bootstrap state machine, the main process SHALL evaluate whether the discovered server is a zombie left over from a prior Electron lifetime. Detection is platform-branched but shares the server-computed `health.bootParentAlive` signal. Common gates (all platforms):

- `health.launchSourceEffective === "electron"`
- This Electron lifetime's `storedSpawnedPid === null` (we did not spawn it)

Platform-specific final gate:

- **macOS / Linux:** `health.ppid !== health.bootParentPid` AND `health.bootParentAlive === false` — the server was reparented away from its boot parent AND that parent is gone. It SHALL NOT test `ppid === 1` (unreliable under Linux subreapers and containers).
- **Windows** (`process.platform === "win32"`): `health.bootParentAlive === false` — Windows never reparents an orphan, so liveness of the boot parent is the sole signal. The Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) remains the first-line guarantee that kills the server on the common crash path; detection is the safety net for bypass cases (`CREATE_BREAKAWAY_FROM_JOB`, nested-job assignment failure, self-respawn). `bootParentAlive` is identity-safe when Tier 2 (`koffi` handle-wait) is available and PID-reuse-vulnerable but functional under Tier 1 fallback.

When a zombie is detected the app SHALL present a modal dialog with three buttons (default: "Leave running"):

- **Take ownership** → call `setSpawnedPid(health.pid)`. Subsequent app quit SHALL stop the server per `decideShutdownOnQuit`.
- **Leave running** → set an in-memory `askedThisSession` flag. No further prompts this session. Next Electron launch SHALL re-evaluate.
- **Stop now** → send SIGTERM to `health.pid`. Poll `isDashboardRunning` for up to 5 seconds. If still alive, send SIGKILL. Then re-enter `selectLaunchSource()` to launch a fresh server.

The modal SHALL be suppressed when Electron is invoked with the command-line switch `--no-zombie-prompt` (used by QA/test runs).

#### Scenario: Zombie detected with reparenting (POSIX)

- **GIVEN** Electron is running on macOS or Linux
- **WHEN** the app launches AND `/api/health` returns `launchSourceEffective: "electron"`, a live `ppid` that differs from `bootParentPid`, `bootParentAlive: false`, and `storedSpawnedPid` is null
- **THEN** the main process SHALL display the adoption modal

#### Scenario: Zombie detected via parent liveness (Windows)

- **GIVEN** Electron is running on Windows AND a prior server survived a Job Object bypass
- **WHEN** the app launches AND `/api/health` returns `launchSourceEffective: "electron"`, `bootParentAlive: false`, and `storedSpawnedPid` is null
- **THEN** the main process SHALL display the adoption modal (regardless of the `ppid` value, since Windows does not reparent)

#### Scenario: Take-ownership transfers shutdown responsibility

- **GIVEN** the adoption modal is displayed
- **WHEN** the user clicks "Take ownership"
- **AND** later quits the app
- **THEN** the app SHALL send a graceful shutdown signal to the previously-zombie server's PID

#### Scenario: Leave-running suppresses re-prompt this session

- **GIVEN** the adoption modal is displayed AND the user clicks "Leave running"
- **WHEN** any other tray or BrowserWindow event would normally trigger re-evaluation
- **THEN** the modal SHALL NOT be re-shown for the remainder of this Electron process lifetime

#### Scenario: Stop-now removes zombie and respawns

- **GIVEN** the adoption modal is displayed AND the user clicks "Stop now"
- **WHEN** the SIGTERM-then-SIGKILL sequence completes
- **THEN** the app SHALL re-enter `selectLaunchSource()` to spawn a new server using the standard launch path

#### Scenario: Modal suppressed under test switch

- **WHEN** Electron is launched with `--no-zombie-prompt`
- **THEN** zombie detection SHALL still run for logging purposes
- **AND** the modal SHALL NOT be displayed regardless of the result
