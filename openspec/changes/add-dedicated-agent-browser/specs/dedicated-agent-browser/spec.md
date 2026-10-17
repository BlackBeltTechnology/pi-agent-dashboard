## Purpose

A Chrome profile owned by the dashboard that agents drive over CDP without any browser extension, so logged-in browsing works on login pages and every agent CDP command passes the dashboard's deny-list, navigation fence and audit.

## ADDED Requirements

### Requirement: Dedicated profile location and persistence

The browser plugin SHALL keep the dedicated profile's Chrome user-data directory at `<dashboard config dir>/agent-chrome` (`~/.pi/dashboard/agent-chrome`), created with owner-only permissions. The directory SHALL persist across Chrome restarts, dashboard restarts and plugin disable/enable. No HTTP route SHALL serve files from it. Downloads in the dedicated profile SHALL land in a server-chosen directory `<dashboard config dir>/agent-chrome-downloads`, reported as `status.dedicated.downloadsDir`. The plugin SHALL NOT claim protection of the profile directory against processes running as the same OS user; the skill and the settings panel SHALL state that limit, and the skill SHALL forbid the agent from reading, copying or launching a browser on that directory, and from reading the downloads directory unless its task names a file there.

#### Scenario: Sign-in survives a graceful dashboard restart

- **WHEN** the user signs in to a site in the dedicated profile and the dashboard restarts through `/api/restart`
- **THEN** after the next dedicated connect the site SHALL still be signed in

#### Scenario: Directory permissions

- **WHEN** the plugin creates the directory on a POSIX host
- **THEN** its mode SHALL be `0700`

### Requirement: Debugging pipe is the only control channel

The dashboard server SHALL launch the dedicated Chrome itself with `--user-data-dir=<dedicated dir>`, `--remote-debugging-pipe` and `--disable-sync`, with the profile's preferences set before launch so that Chrome's password manager and browser sign-in are off (website sign-in still works), and SHALL NOT pass `--remote-debugging-port`, `--enable-automation` or `--headless`. While the dashboard runs that Chrome, the server process SHALL be its only CDP client, and agents and other plugins SHALL reach it only through the dashboard's CDP proxy endpoint, where the relay deny-list, navigation fence and audit apply as for the browser relay.

#### Scenario: No saved passwords

- **WHEN** the user signs in to a site in the dedicated profile
- **THEN** Chrome SHALL NOT offer to save the password, and no password SHALL be autofilled into a later agent tab

#### Scenario: No network debugging endpoint

- **WHEN** the dedicated Chrome launched by the dashboard is running
- **THEN** no TCP socket of that Chrome's process tree SHALL accept a DevTools connection

#### Scenario: Deny-list applies

- **WHEN** a client connected through the dedicated `cdpUrl` sends `Network.getAllCookies`
- **THEN** the proxy SHALL answer with the relay deny-list error, SHALL append a `denied` audit entry for profile `@dedicated`, and SHALL NOT forward the command to Chrome

### Requirement: Dedicated deny set

Because the dedicated profile is driven at browser level with no extension in between, the proxy SHALL additionally, for dedicated clients only:
- allow `Page.navigate` and `Target.createTarget` only for `https:`, `http:` and exactly `about:blank`, and deny every other URL (this covers `chrome:`, `chrome-untrusted:`, `devtools:`, `chrome-extension:` and `about:` aliases of them);
- treat any target whose URL uses `chrome:`, `chrome-untrusted:`, `devtools:` or `chrome-extension:` as hidden, re-evaluated whenever its URL changes, so the agent cannot attach to a privileged page the user opened;
- remove cookie data from forwarded `Network` events: `Cookie` and `Set-Cookie` headers and the cookie fields of `Network.requestWillBeSentExtraInfo` and `Network.responseReceivedExtraInfo`;
- deny `Target.attachToBrowserTarget`, `Target.exposeDevToolsProtocol`, `Browser.close`, `Browser.crash`, `Browser.crashGpuProcess`, `Browser.setPermission`, `Browser.grantPermissions`, `Browser.resetPermissions`, every `Extensions.*` and `Tethering.*` method, cookie writes and clears (`Network.setCookie`, `Network.setCookies`, `Network.deleteCookies`, `Network.clearBrowserCookies`, `Storage.setCookies`, `Storage.clearCookies`), every `Storage.clearData*` method, and `Fetch.*` or `Network.*` sent on the browser-level session (no `sessionId`);
- answer `Page.setDownloadBehavior` locally with an empty success result and a `dropped` audit entry.

Denials use the relay's CDP error and `denied` audit entry. A Playwright `connectOverCDP` client SHALL still complete its handshake. Every method of the `Browser`, `Target`, `Storage`, `Tethering`, `SystemInfo` and `Extensions` domains in the protocol version the dashboard targets SHALL be classified as allowed, handled by the proxy, or denied; an unclassified method SHALL be denied.

#### Scenario: Browser-level attach refused

- **WHEN** a dedicated client sends `Target.attachToBrowserTarget`
- **THEN** the proxy SHALL answer with the CDP deny error and append a `denied` audit entry

#### Scenario: Chrome settings page refused

- **WHEN** a dedicated client sends `Page.navigate {url: "chrome://settings"}`
- **THEN** the proxy SHALL deny it and the tab SHALL NOT navigate

#### Scenario: about: alias refused

- **WHEN** a dedicated client sends `Page.navigate {url: "about:settings"}`
- **THEN** the proxy SHALL deny it

#### Scenario: Privileged page opened by the user stays hidden

- **WHEN** the user opens `chrome://password-manager` in the dedicated window while a client is connected
- **THEN** the client SHALL NOT see or attach to that tab

#### Scenario: Cookie headers stripped

- **WHEN** a dedicated client enables `Network` on its page and the page sends a request carrying cookies
- **THEN** no event forwarded to the client SHALL contain a `Cookie` header or the cookie values

#### Scenario: Site data wipe refused

- **WHEN** a dedicated client sends `Storage.clearDataForOrigin {origin: "https://accounts.google.com", storageTypes: "cookies"}`
- **THEN** the proxy SHALL deny it

#### Scenario: Playwright still attaches

- **WHEN** `agent-browser connect <dedicated cdpUrl>` runs
- **THEN** it SHALL list pages and navigate to an allowed https URL

### Requirement: Availability

`GET /api/browser/status` SHALL include `dedicated: {available, reason?, state, dataDir, downloadsDir, sizeBytes?, lastUsed?, instanceId?, holder?}`, where `state` is `not-created` (no profile directory yet), `stopped`, `starting` or `running`, and `holder` names the live client (`sessionId` or `client` label). `available` SHALL be false with `reason: "no-chrome"` when no Google Chrome binary is found at the platform's standard install locations, and with `reason: "no-display"` when the host has no system-open capability. `available` SHALL NOT depend on the user's default Chrome data directory. Callers SHALL treat the dedicated profile as usable only when `status.enabled` and `status.dedicated.available` are both true.

#### Scenario: Docker host

- **WHEN** the dashboard runs in a container without a display
- **THEN** `status.dedicated.available` SHALL be `false` with `reason: "no-display"` and dedicated connect SHALL return 503 with that reason

#### Scenario: Chrome installed but never launched

- **WHEN** the Google Chrome binary exists but the default Chrome data directory does not
- **THEN** `status.canOpenChrome` SHALL be `false` and `status.dedicated.available` SHALL be `true`

#### Scenario: First use

- **WHEN** the dedicated directory does not exist
- **THEN** `status.dedicated.state` SHALL be `not-created`

### Requirement: Dedicated connect

`POST /api/browser/dedicated/connect {client?}` SHALL start the dedicated Chrome when it is not running, and SHALL return `{cdpUrl, instanceId}`, where `cdpUrl` is a dashboard CDP proxy URL of the same form the relay returns and `instanceId` is non-secret. It SHALL answer 403 when the plugin is disabled and 503 with a reason when unavailable. The dedicated profile SHALL serve one CDP client at a time: while a dedicated instance is live, a further connect SHALL return 409 `{reason: "busy", instanceId, holder}`, independent of `allowMultipleInstancesPerProfile`. When another dashboard server process on the same host owns the running dedicated Chrome, connect SHALL return 409 `{reason: "owned-by-other-server"}`. When a Chrome the dashboard did not launch already uses the profile directory, or Chrome exits or answers nothing on the pipe within 15 s of launch, connect SHALL return 503 `{reason: "profile-in-use"}` or `{reason: "launch-failed"}` respectively and SHALL leave no instance registered. The route SHALL use the same network guard as the other `/api/browser/*` routes; the returned `cdpUrl` SHALL be usable only from loopback, like the relay's.

#### Scenario: First connect starts Chrome

- **WHEN** the dedicated Chrome is stopped and a client posts dedicated connect
- **THEN** Chrome SHALL start, the response SHALL carry `{cdpUrl, instanceId}`, and `agent-browser connect <cdpUrl>` SHALL list its pages

#### Scenario: Second client

- **WHEN** a dedicated instance is live and another connect arrives
- **THEN** the response SHALL be 409 `{reason: "busy", instanceId: <live instance>, holder}`

#### Scenario: Concurrent first connects

- **WHEN** two dedicated connect or open requests arrive while Chrome is stopped
- **THEN** exactly one Chrome process SHALL be launched

#### Scenario: Profile already open elsewhere

- **WHEN** the user started Chrome on the dedicated directory by hand and a dedicated connect arrives
- **THEN** the response SHALL be 503 `{reason: "profile-in-use"}` within 15 s

#### Scenario: Remote client cannot use the cdpUrl

- **WHEN** a non-loopback client opens the returned `cdpUrl`
- **THEN** the WebSocket upgrade SHALL be refused

#### Scenario: Client disconnects

- **WHEN** the CDP client socket of the dedicated instance closes
- **THEN** the instance SHALL close, the tabs that client created SHALL close, the dedicated Chrome SHALL keep running, and a new connect SHALL succeed

#### Scenario: Client never attaches

- **WHEN** no CDP client attaches to a dedicated `cdpUrl` within 30 s
- **THEN** the instance SHALL close with a `detach` audit entry with detail `no-cdp-client` and the dedicated Chrome SHALL keep running

#### Scenario: Kill switch during launch

- **WHEN** `PUT /api/browser/enabled {enabled: false}` completes while a dedicated connect is waiting for Chrome to start
- **THEN** the connect SHALL fail, no dedicated instance SHALL remain registered, and the dedicated Chrome SHALL be closed

### Requirement: Chrome lifetime is bound to the dashboard

The server SHALL close the dedicated Chrome, letting it flush its profile, when the dashboard shuts down, when the plugin is disabled (`enabled: false`), and on `POST /api/browser/dedicated/stop`. Open tabs are not preserved. The server SHALL record which server process owns the running dedicated Chrome. Before launching, it SHALL terminate a dedicated Chrome whose owning server process is no longer running, and SHALL NOT terminate one whose owning server process is still running. A process SHALL be identified as the dedicated Chrome only by its command line carrying both `--remote-debugging-pipe` and the dedicated `--user-data-dir`, never by a bare pid.

When the dedicated Chrome exits for any other reason (the user closes its last window, quits it, or it crashes), the server SHALL close the live instance with a `detach` audit entry with detail `closed:chrome-exited`, report `state: "stopped"`, clear its ownership record, and launch a new Chrome on the next connect or open.

#### Scenario: Restart closes Chrome

- **WHEN** `/api/restart` is called while the dedicated Chrome runs
- **THEN** that Chrome process tree SHALL exit, and the next dedicated connect SHALL start a new one with the same profile

#### Scenario: Orphan after a crash

- **WHEN** the owning server process died without closing Chrome and a dedicated connect arrives
- **THEN** the orphaned Chrome SHALL be terminated and a new one started, and the connect SHALL succeed

#### Scenario: Another dashboard owns it

- **WHEN** a second dashboard server on the same host receives a dedicated connect while the first server's dedicated Chrome runs
- **THEN** the second SHALL return 409 `{reason: "owned-by-other-server"}` and the first server's Chrome SHALL keep running

#### Scenario: User closes the dedicated window

- **WHEN** the user closes the dedicated Chrome's last window while an agent client is connected
- **THEN** the client socket SHALL close, the audit SHALL gain `detach` with detail `closed:chrome-exited`, `status.dedicated.state` SHALL be `stopped`, and the next connect SHALL start Chrome again

#### Scenario: Kill switch

- **WHEN** `PUT /api/browser/enabled {enabled: false}` is called
- **THEN** the dedicated instance SHALL close and the dedicated Chrome SHALL exit before the response

### Requirement: Sign-in window, hidden tabs and reset

`POST /api/browser/dedicated/open {url?}` SHALL start the dedicated Chrome when needed and open a new tab owned by the server, defaulting to `https://accounts.google.com/`, with an `open` audit entry. `url` SHALL be an `https:` URL that passes the effective allowed domains; any other value SHALL be answered with 400 and open nothing. Server-owned tabs, their child targets (frames, workers) and pages opened from them SHALL be hidden from agent clients until they close: any client command naming one's target or session SHALL fail with a CDP error, no result or event sent to a client SHALL name one, and none SHALL be left paused waiting for a debugger. Hidden tabs SHALL NOT appear in `browser_relay_status`, and a viewer subscribe to one SHALL be refused and audited as `viewer-subscribe-refused`. `POST /api/browser/dedicated/reset` SHALL delete the dedicated profile directory and SHALL return 409 unless the dedicated Chrome is stopped.

#### Scenario: Open to sign in

- **WHEN** the user presses "Open to sign in"
- **THEN** a Chrome window of the dedicated profile SHALL show the sign-in page, and a connected agent client SHALL neither see that tab in `Target.getTargets` nor be able to attach to it

#### Scenario: Probe of a hidden tab

- **WHEN** a client sends `Target.getTargetInfo` or `Target.attachToTarget` naming a hidden tab's `targetId`
- **THEN** the proxy SHALL answer with a CDP error

#### Scenario: Popup from the sign-in tab stays hidden

- **WHEN** the hidden sign-in page opens a popup and a client has auto-attach and discovery enabled
- **THEN** the client SHALL receive no attach or discovery event for the popup, and the popup SHALL load normally

#### Scenario: Unsafe open URL

- **WHEN** `dedicated/open` is called with `{url: "javascript:alert(1)"}` or `{url: "chrome://settings"}`
- **THEN** the response SHALL be 400 and no tab SHALL open

#### Scenario: Reset while running

- **WHEN** reset is requested while the dedicated Chrome runs
- **THEN** the response SHALL be 409 and the directory SHALL be unchanged

### Requirement: Discovery and auto-attach in the dedicated profile

`agent-browser connect <cdpUrl>` and Playwright `chromium.connectOverCDP(cdpUrl)` SHALL complete their handshake against a dedicated instance and SHALL be able to create, navigate and drive tabs. The proxy SHALL serve `Target.setDiscoverTargets` and browser-level `Target.setAutoAttach` itself rather than forwarding them: it SHALL announce and attach only targets that are not hidden, honour the client's `waitForDebuggerOnStart` only for those, and resume any hidden target Chrome paused. Child sessions of attached pages SHALL behave as Chrome reports them.

#### Scenario: Auto-attach with a sign-in tab open

- **WHEN** a hidden sign-in tab is open and `agent-browser connect <cdpUrl>` runs
- **THEN** the agent SHALL see only its own pages, and the sign-in tab SHALL keep responding to the user

#### Scenario: Discovery announces once

- **WHEN** a client enables auto-attach, creates a tab, and then enables discovery
- **THEN** that tab SHALL be announced by `Target.targetCreated` exactly once
