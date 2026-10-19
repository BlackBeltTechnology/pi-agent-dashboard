# electron-browser-host Specification

## Purpose
TBD - created by archiving change add-operator-browser-relay. Update Purpose after archive.

## Requirements

### Requirement: Trusted browser-host IPC surface

The main-window preload SHALL expose `window.piDashboard.browserHost` only when the window is on its local origin, and SHALL expose only: `identity()`, `sign(nonce, serverId)`, `onConnect(cb)`, `respondConnect(requestId, ok, reason?)`, `cancelConnect(requestId)`, `extSend(linkId, data)`, `extClose(linkId, code)`, `onExt(cb)`, `tee(linkId, instanceId, tabId, on)`, `onFrame(cb)`, `setToken(profileDirectory, token|null)`, `listConsents()`, `revokeConsent(key)`. Every channel SHALL be served through the trusted-sender wrappers, so a sender that is not the local loading page or the loopback origin on the configured port SHALL be refused. `identity()` SHALL return `{hostId, publicKey, label, platform, canOpenChrome, profiles}` and never a private key or token.

#### Scenario: Remote-origin window
- **WHEN** the main window loads a remote dashboard origin
- **THEN** `window.piDashboard.browserHost` SHALL be undefined, and a direct IPC invoke of any browser-host channel from that frame SHALL be rejected with `UntrustedSenderError`

#### Scenario: Stable identity
- **WHEN** Electron restarts with encryption available
- **THEN** `identity().hostId` and `publicKey` SHALL be unchanged

### Requirement: Host key pair

Electron main SHALL generate an Ed25519 key pair on first use, derive `hostId` as `host-` plus the first 32 hex characters of SHA-256 of the public key, and store the private key only through `safeStorage`; where encryption is unavailable the key pair SHALL be kept in memory only for that run. `sign(nonce, serverId)` SHALL refuse unless `serverId` equals the `/api/health` `instanceId` main fetched from the target the window is switched to, SHALL otherwise sign `"pi-browser-host-v1\n" + nonce + "\n" + serverId`, and the private key SHALL never cross IPC.

#### Scenario: Signature verifies
- **WHEN** the window is switched to a target whose `/api/health` `instanceId` is I and `sign(n, I)` is called
- **THEN** the returned signature SHALL verify against `identity().publicKey` for that exact message and SHALL NOT verify for another `serverId`

#### Scenario: Challenge from a different server
- **WHEN** `sign(n, J)` is called with `J` different from the target's `instanceId`
- **THEN** the call SHALL be refused and nothing SHALL be signed

### Requirement: Loopback relay shim

After the operator allows a `browser_host_connect`, Electron main SHALL ensure a WebSocket listener on `127.0.0.1` with an ephemeral port, register the `linkId` once, and open the extension's `connect.html` in that Chrome profile with `mcpRelayUrl=ws://127.0.0.1:<port>/ws/browser-ext/<linkId>` and `protocolVersion=2` (plus `token=` when a local token is stored). The listener SHALL accept an upgrade only for a registered, unclaimed `linkId` with `Origin: chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm`, at most one socket per link, and SHALL answer 404 otherwise. On accept it SHALL emit `ext_open`, relay every frame in both directions through the IPC surface, and emit `ext_close` with the close code. `cancelConnect`, carrier loss, and renderer navigation, reload or destruction SHALL close every link and dialog of that window. The listener SHALL stop when no link is registered.

#### Scenario: Extension attaches through the shim
- **WHEN** the operator allowed a connect and the extension dials `127.0.0.1:<port>/ws/browser-ext/<linkId>` with the pinned Origin
- **THEN** the shim SHALL accept it and `ext_open {linkId}` SHALL be emitted

#### Scenario: Web page probes the shim
- **WHEN** a page on the operator machine dials the shim with a web Origin
- **THEN** the upgrade SHALL be rejected and no `ext_open` SHALL be emitted

#### Scenario: Link used twice
- **WHEN** a second upgrade arrives for a claimed `linkId`
- **THEN** it SHALL be rejected

#### Scenario: Reload mid-connect
- **WHEN** the renderer reloads while a consent dialog is open
- **THEN** the dialog SHALL close, the `linkId` SHALL be unregistered, and no Chrome launch SHALL occur

### Requirement: Operator consent per server and profile

Before launching Chrome for a `browser_host_connect`, Electron main SHALL look up consent for (server key, `profileDirectory`), where server key is the WS target origin the window is switched to plus that target's `/api/health` `instanceId` fetched by main from the target. Without a stored consent it SHALL show a native dialog parented to the main window that names `serverLabel` and the profile label, with buttons Allow once, Always allow and Deny, where the default and Escape are Deny. Deny, closing the dialog, or no answer within 55 s SHALL answer `respondConnect(requestId, false, "denied")` and launch nothing. Always allow SHALL persist the consent in `browser-host-consent.json` in userData with owner-only permissions where the OS supports them, until revoked. When the target's `/api/health` cannot be fetched, main SHALL answer `respondConnect(requestId, false, "server-unverified")` without a dialog and launch nothing. An unreadable consent file SHALL be renamed with a `.corrupt-<ts>` suffix and treated as empty. `revokeConsent` and the app menu item "Browser relay → Revoke all" SHALL remove consents for future connects without closing live instances.

#### Scenario: First connect asks
- **WHEN** no consent is stored for (S, P) and a connect arrives
- **THEN** the dialog SHALL be shown once and Chrome SHALL launch only after Allow once or Always allow

#### Scenario: Remembered consent
- **WHEN** Always allow was chosen for (S, P) and another connect arrives
- **THEN** no dialog SHALL be shown and Chrome SHALL launch

#### Scenario: Re-paired server asks again
- **WHEN** a consent exists for S's origin but the target's `/api/health` reports a different `instanceId`
- **THEN** the dialog SHALL be shown

#### Scenario: No answer
- **WHEN** the dialog is left open for 55 s
- **THEN** the connect SHALL be answered denied and the dialog closed

#### Scenario: Target cannot be verified
- **WHEN** a connect arrives and the target's `/api/health` request fails
- **THEN** no dialog SHALL be shown, no Chrome SHALL launch, and the connect SHALL be answered `ok: false, reason: "server-unverified"`

#### Scenario: Revoke all from the menu
- **WHEN** the operator chooses "Browser relay → Revoke all" with two stored consents and one live instance
- **THEN** `listConsents()` SHALL return none, the live instance SHALL stay open, and the next connect SHALL show the dialog

### Requirement: Local pairing token store

`setToken(profileDirectory, token)` SHALL store the token only through `safeStorage` in userData; where encryption is unavailable the token SHALL be kept in memory only. A stored token SHALL be appended as `token=` to that profile's connect URL. A token SHALL never be sent to the server, returned by any IPC call, or written to a log.

#### Scenario: Token never leaves the machine
- **WHEN** a token is set for profile P and a connect for P runs
- **THEN** the URL opened in Chrome SHALL carry `token=`, and no `browser_host_*` message and no IPC return value SHALL contain the token

### Requirement: Local Chrome profiles and launch

Electron main SHALL list profiles from the operator machine's Chrome `Local State` and decide `installed` and the Chrome launch command with the same shared helpers the browser plugin uses. `canOpenChrome` SHALL be false when no desktop Chrome user-data directory exists; then no launch SHALL be attempted and the connect SHALL be answered `respondConnect(requestId, false, "no-chrome")`.

#### Scenario: Profiles match the plugin's parsing
- **WHEN** the same `Local State` fixture is parsed by the plugin and by Electron
- **THEN** both SHALL produce identical `{profileDirectory, label, email, installed}` rows

### Requirement: Local frame tee

While `tee(linkId, instanceId, tabId, true)` is active, Electron main SHALL copy every extension event on that link whose `source.tabId` equals `tabId`, whose `source` has no `sessionId`, and whose method is `Page.screencastFrame`, to `onFrame({instanceId, tabId, jpegBase64, metadata})`, and SHALL still forward the event to the server unchanged. `tee(..., false)` or link close SHALL stop the copy. The copy SHALL reach `onFrame` within 50 ms (p95) of the event's receipt by main, and on a repainting page over a LAN the operator pane SHALL show at least 8 frames per second.

#### Scenario: Pane renders without the server round trip
- **WHEN** the operator's pane subscribed with `local: true` and the tab repaints
- **THEN** the pane SHALL render the frame from `onFrame`, and the server SHALL still receive and acknowledge the frame event

#### Scenario: Child-session frames are not copied
- **WHEN** an extension event for the same tab carries `source.sessionId` (an iframe or worker session)
- **THEN** it SHALL NOT be copied to `onFrame`

#### Scenario: Tee latency budget
- **WHEN** 200 `Page.screencastFrame` events of 20 KB are received by main for a teed tab
- **THEN** the p95 delay from receipt to the `onFrame` call SHALL be at most 50 ms
