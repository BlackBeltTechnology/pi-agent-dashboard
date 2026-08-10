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
reject calls that do not originate from a trusted frame (the local `file://`
loading page or the expected dashboard origin). The gated handlers SHALL include
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

### Requirement: Reachability probe rejects internal targets
The server reachability probe SHALL reject target URLs that resolve to loopback,
private (RFC1918), or link-local address ranges, and SHALL be callable only from
the trusted wizard window. The probe SHALL continue to fetch only the
`/api/health` path with a bounded timeout.

#### Scenario: Cloud-metadata target rejected
- **WHEN** `probeServer` is called with `http://169.254.169.254/…`
- **THEN** the probe SHALL refuse and return an error without performing the fetch

#### Scenario: Private-range target rejected
- **WHEN** `probeServer` is called with a host resolving to `10.0.0.0/8` or `192.168.0.0/16`
- **THEN** the probe SHALL refuse

#### Scenario: Legitimate remote host allowed from wizard
- **WHEN** the trusted wizard window probes a public dashboard URL
- **THEN** the probe SHALL fetch `/api/health` and return reachability
