# electron-renderer-hardening Specification

## Purpose
Keep untrusted remote dashboard content in the Electron main window away from privileged local bridges, IPC handlers, OS protocol handlers and internal-network probes.

## Requirements

### Requirement: Untrusted remote content receives no privileged wizard bridges
The main window preload SHALL NOT expose the wizard bridges (`window.remoteConnect`,
`window.electron.doctor`) to content it loads, because in remote mode the main
window loads untrusted remote content. The `remoteConnect` and `doctor` bridges
SHALL be exposed only on their dedicated wizard windows, which load trusted local
`file://` content.

#### Scenario: Remote content cannot reach remoteConnect
- **WHEN** the main window has loaded a remote URL and remote script reads `window.remoteConnect`
- **THEN** the bridge SHALL be undefined (not injected into the main window)

#### Scenario: Remote content cannot reach doctor bridge
- **WHEN** remote content reads `window.electron.doctor`
- **THEN** the bridge SHALL be undefined in the main window

#### Scenario: Wizard windows retain their bridges
- **WHEN** the remote-connect wizard window (trusted local file) loads
- **THEN** `window.remoteConnect` SHALL be available there as before

### Requirement: IPC handlers validate the sender frame
Privileged main-process IPC handlers SHALL validate `event.senderFrame` and
reject calls that do not originate from a trusted frame: the local `file://`
`loading.html` page, or the LOCAL dashboard origin (loopback host on the
configured port). A remote/tunnel dashboard origin is NOT trusted. The gated handlers SHALL include
`request-launch`, `read-server-log`, `probe-server`, and `open-doctor`. A rejected call SHALL return an error and perform
no privileged action.

#### Scenario: Remote frame denied
- **WHEN** a handler is invoked from a frame whose origin is the remote/tunnel URL
- **THEN** the handler SHALL reject the call and SHALL NOT read logs, spawn processes, or probe

#### Scenario: Trusted loading frame allowed
- **WHEN** the local `file://` loading page invokes `request-launch`
- **THEN** the handler SHALL proceed as before

### Requirement: shell.openExternal enforces a scheme allowlist
The application SHALL open external URLs only when the scheme is `http`, `https`,
or `mailto`. Both the `setWindowOpenHandler` path and the `will-navigate`
open-external branch SHALL apply this allowlist; any other scheme (e.g. `file:`,
`ms-msdt:`, `search-ms:`, `smb:`) SHALL be dropped without invoking
`shell.openExternal`.

#### Scenario: file scheme dropped
- **WHEN** renderer content calls `window.open("file:///Applications/Calculator.app")`
- **THEN** `shell.openExternal` SHALL NOT be invoked

#### Scenario: OS custom protocol dropped
- **WHEN** renderer content navigates to `ms-msdt:/id`
- **THEN** the navigation SHALL NOT be forwarded to `shell.openExternal`

#### Scenario: http link opened
- **WHEN** renderer content opens `https://example.com`
- **THEN** `shell.openExternal` SHALL be invoked with that URL

### Requirement: Reachability probe rejects metadata and unspecified targets
The server reachability probe SHALL reject target URLs that resolve to
link-local (`169.254.0.0/16`, `fe80::/10`, including cloud-metadata
`169.254.169.254`) or unspecified (`0.0.0.0/8`, `::`) addresses — including
IPv4-mapped IPv6 and non-canonical IP encodings — before performing any fetch.
Loopback and private (RFC1918 / unique-local) targets SHALL remain allowed,
because LAN, localhost and Docker dashboards are the primary remote-connect use
case; the probe SHALL be reachable only from trusted frames (see the IPC
requirement), which closes the untrusted-renderer SSRF vector. The probe SHALL
continue to fetch only the `/api/health` path with a bounded timeout.

#### Scenario: Cloud-metadata target rejected
- **WHEN** `probeServer` is called with `http://169.254.169.254/…` (or `http://2852039166`, `http://[::ffff:169.254.169.254]`)
- **THEN** the probe SHALL refuse with an error and SHALL NOT perform the fetch

#### Scenario: Hostname resolving to link-local rejected
- **WHEN** `probeServer` is called with a hostname any of whose resolved addresses is link-local
- **THEN** the probe SHALL refuse and SHALL NOT perform the fetch

#### Scenario: LAN and loopback remotes still probe
- **WHEN** the trusted wizard / loading page probes `http://192.168.16.242:8000`, `http://10.0.0.5:8000` or `http://localhost:8000`
- **THEN** the probe SHALL fetch `/api/health` and return reachability

#### Scenario: Legitimate public host allowed
- **WHEN** a trusted frame probes a public dashboard URL
- **THEN** the probe SHALL fetch `/api/health` and return reachability

### Requirement: Bundled local renderer pages enforce Trusted Types
Every HTML page the Electron shell loads from its own bundle (the loading, connecting, remote-connect, and doctor windows) SHALL declare its own Content-Security-Policy. That policy SHALL include `default-src 'none'` and an enforced `require-trusted-types-for 'script'`, plus only the allowances the page needs. Markup the page inserts SHALL go through a page-local policy registered before first use, or be built with DOM APIs; data SHALL be escaped or set as text.

#### Scenario: Doctor page has a policy
- **WHEN** the doctor window loads
- **THEN** its document carries a Content-Security-Policy with `default-src 'none'` and `require-trusted-types-for 'script'`

#### Scenario: Server name with markup in the remote list
- **WHEN** a discovered or recent server URL contains `"><img src=x onerror=alert(1)>`
- **THEN** the remote-connect list shows it as text and no handler runs

#### Scenario: Loading page still probes local servers
- **WHEN** the loading window probes a loopback dashboard's health endpoint
- **THEN** the request is allowed by the page policy and a reachable server is reported reachable

#### Scenario: Pages render under enforcement
- **WHEN** the loading, connecting, remote-connect, and doctor windows open with real data, including a known-server list on the loading page
- **THEN** each renders fully with zero Trusted Types violations

### Requirement: The app default session denies permissions except a fixed allowlist for the main window's origin

Before any window is created, the app SHALL install handlers on the default session that allow only `clipboard-sanitized-write`, `notifications` and `fullscreen`, only for the main frame at the origin of the main window's current URL when the navigate-to-server allowlist trusts it. A check with no document (a service worker) is judged by its origin and allowed only for `notifications`. All else, including `openExternal`, SHALL be denied and logged once per permission and origin.

#### Scenario: remote main-window content cannot use the camera

- **GIVEN** the main window has loaded a remote server in remote mode
- **WHEN** its page calls `navigator.mediaDevices.getUserMedia({ video: true })` or `navigator.geolocation.getCurrentPosition`
- **THEN** the request SHALL be denied without any in-app prompt

#### Scenario: the dashboard origin keeps its three permissions

- **WHEN** the main frame at the main window's server origin requests `notifications`, `fullscreen` or `clipboard-sanitized-write`
- **THEN** each SHALL be granted

#### Scenario: a subframe or a foreign origin is denied

- **WHEN** an iframe, or a page at any origin other than the main window's server origin, requests `notifications`
- **THEN** the request SHALL be denied

#### Scenario: the grant follows a navigation to another allowed origin

- **GIVEN** the main window was created for one origin and `dashboard:navigate-to-server` then loaded a loopback variant or a known server
- **WHEN** the main frame at the new origin requests `notifications`, and a page at the original origin requests it
- **THEN** the first SHALL be granted and the second denied

#### Scenario: bundled local windows receive no permission

- **WHEN** the doctor, remote-connect, connecting or splash window requests any permission
- **THEN** the request SHALL be denied

#### Scenario: no main window yet

- **WHEN** a permission request arrives while no main window server URL is set
- **THEN** it SHALL be denied

#### Scenario: a service-worker notification check at the dashboard origin is allowed

- **WHEN** the check handler runs for `notifications` with the main window's server origin as `requestingOrigin`, no `requestingUrl` and no main frame
- **THEN** it SHALL return true

#### Scenario: a service-worker check for any other permission is denied

- **WHEN** the check handler runs with no `requestingUrl` for `media` or `clipboard-sanitized-write`
- **THEN** it SHALL return false

#### Scenario: openExternal permission is denied

- **WHEN** a page at the main window's server origin requests the `openExternal` permission
- **THEN** it SHALL be denied, and links SHALL keep reaching the OS only through the http/https/mailto scheme allowlist
