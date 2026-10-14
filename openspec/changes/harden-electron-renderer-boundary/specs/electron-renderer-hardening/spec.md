## ADDED Requirements

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
