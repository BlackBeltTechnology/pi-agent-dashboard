## MODIFIED Requirements

### Requirement: Extension dials in on a per-connection relay endpoint

The dashboard SHALL expose a WebSocket endpoint `/ws/browser-ext/<guid>` that accepts exactly one connection from the pinned Playwright Chrome Extension per guid. The guid SHALL be at least 128 bits of randomness, minted server-side per connect request, never written to logs, and never persisted. A guid not claimed by an extension socket before the connect timeout (60 s) SHALL expire. For a connect targeted at an operator browser host, the guid SHALL be claimable only by that host's operator link (see `browser-operator-host`) and never by an upgrade on `/ws/browser-ext/<guid>`; the one-extension-per-guid rule SHALL apply to the link.

#### Scenario: Pinned extension connects

- **WHEN** a WebSocket upgrade arrives on `/ws/browser-ext/<guid>` with `Origin: chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm` from a loopback peer and `<guid>` is a live, unclaimed guid
- **THEN** the relay SHALL accept the socket and mark the guid claimed

#### Scenario: Unknown origin is rejected

- **WHEN** an upgrade arrives on `/ws/browser-ext/<guid>` with any Origin other than the pinned extension id (including a loopback page origin such as `http://localhost:5173`, or absent Origin)
- **THEN** the upgrade SHALL be rejected with HTTP 403 and the guid SHALL remain unclaimed

#### Scenario: Second extension socket on a claimed guid

- **WHEN** a second upgrade arrives for a guid already holding an extension socket
- **THEN** the second socket SHALL be closed with code 1000 and reason `Another extension connection already established`

#### Scenario: Unknown guid

- **WHEN** an upgrade arrives for a guid the relay never minted or already expired
- **THEN** the upgrade SHALL be rejected with HTTP 404

#### Scenario: Operator-targeted guid is not claimable on the endpoint

- **WHEN** a connect targeted at operator host H is pending and an upgrade arrives on `/ws/browser-ext/<guid>` for its guid from a loopback peer with the pinned Origin
- **THEN** the upgrade SHALL be rejected with HTTP 404 and the guid SHALL remain claimable by H's link

### Requirement: Per-session isolation via tab groups

Each guid SHALL map to its own tab group inside the target Chrome profile. Tabs created through one guid SHALL NOT be visible as targets to a CDP client attached to a different guid. Each live instance SHALL expose a non-secret `instanceId` (distinct from the guid, unusable to open any socket) for UI and audit addressing.

#### Scenario: Two sessions, one profile

- **WHEN** two pi sessions each obtain a guid for the same profile and each creates a tab
- **THEN** each CDP client SHALL see only its own tab in `Target.getTargets` and the profile SHALL show two distinct coloured tab groups

#### Scenario: Profile cannot host a second concurrent instance

- **WHEN** the extension refuses a second concurrent relay connection from the same profile (behaviour established by the pre-implementation spike)
- **THEN** `POST /api/browser/connect` for a profile that already has a live instance on the same host (the dashboard host, or the same operator browser host) SHALL return 409 `{reason: "busy", instanceId}`, and the first instance SHALL be unaffected; a profile with the same `profileDirectory` on a different host SHALL NOT count as busy

#### Scenario: CDP client disconnects

- **WHEN** the CDP client socket for a guid closes for any reason
- **THEN** the relay SHALL close the instance: the extension socket closes, all controlled tabs are detached, the tab group is released, and the guid expires

#### Scenario: CDP client never attaches

- **WHEN** the extension handshake completed but no CDP client attached within 30 s
- **THEN** the relay SHALL close the instance exactly as above and record an audit entry of kind `detach` with detail `no-cdp-client`

#### Scenario: Last controlled tab closed

- **WHEN** the user closes the last tab in a guid's tab group
- **THEN** the extension socket SHALL close with reason `All controlled tabs detached`, the CDP socket SHALL close with reason `Extension disconnected`, and the guid SHALL expire

### Requirement: Audit trail

The relay SHALL record, per guid, an in-memory ring (≥ 500 entries) of `{ts, profile, kind, detail}` for these kinds: `attach`, `detach`, `navigate`, `createTarget`, `denied`, `dropped`, `open`, `viewer-subscribe`, `viewer-subscribe-refused` and `viewer-input`. `detail` SHALL carry URLs (redacted per "Extension-internal URLs and the connect tab never reach a viewer") and method names only, except that entries for an operator browser host SHALL also carry the literal `host:<hostId>` and dropped operator messages SHALL carry `browser_host:<type>`. Host-level entries that belong to no guid SHALL be stored under the profile key `host:<hostId>`. It SHALL never carry request/response payloads, the guid or the token.

#### Scenario: Audit read

- **WHEN** an authenticated dashboard client calls `GET /api/browser/audit?profile=<profileDirectory>`
- **THEN** the response SHALL list entries newest-first (each tagged with `instanceId`) with no payload bodies and no guid/token values

#### Scenario: Acknowledged-and-dropped verb is distinguishable from a denial

- **WHEN** the relay acknowledges and drops `Browser.setDownloadBehavior`
- **THEN** the audit entry SHALL have kind `dropped`, not `denied`

#### Scenario: Operator-hosted attach is attributable

- **WHEN** an extension attaches through operator host H's link
- **THEN** the `attach` entry's `detail` SHALL contain `host:<H>` and SHALL contain neither the guid nor the `linkId`

### Requirement: Profile discovery and capability

`GET /api/browser/status` SHALL return `{enabled, canOpenChrome, operatorHosts: true}` where `canOpenChrome` is true iff the dashboard host can open a URL in a named Chrome profile and `operatorHosts: true` advertises operator browser host support. `GET /api/browser/profiles` SHALL list Chrome profiles from the host's `Local State` profile cache with `{profileDirectory, label, email?, installed, hasToken, zeroDialog, instances: [{instanceId, tabs: [{tabId, title, url}]}]}` keyed by `profileDirectory` (labels are user-editable and may duplicate), where `installed` is true iff the pinned extension directory exists under that profile and `instances` lists live relay instances (empty = not connected). The response SHALL additionally carry `operatorHosts` as specified in `browser-operator-host` (an empty array when none). When the Chrome user-data directory or `Local State` is absent or unparseable, the response SHALL be 200 with a single synthetic row `{profileDirectory: "Default", label: "Default", installed: <dir check>, …}` and a `warning` string naming the path.

#### Scenario: Extension absent in a profile

- **WHEN** the extension directory does not exist under `<profileDirectory>/Extensions/`
- **THEN** the profile row SHALL report `installed: false` and `POST /api/browser/connect` for it SHALL return 409 `{reason: "not-installed"}` with a message pointing at the Web Store install

#### Scenario: Host cannot open Chrome

- **WHEN** the host has no system-open capability (headless / container)
- **THEN** `status.canOpenChrome` SHALL be `false` and `POST /api/browser/connect` SHALL return 503

### Requirement: Connect and CDP-URL lifecycle

`POST /api/browser/connect?profile=<profileDirectory>` SHALL mint a guid, open the extension's `connect.html` in that profile with `protocolVersion=2` and, when the profile config sets `zeroDialog: true` and a token is stored, `token=<token>`, and return `{cdpUrl, instanceId}` once the extension handshake completes (timeout 60 s → 504 and the guid expires). An optional `host` selects where Chrome runs: omitted or `"dashboard"` targets the dashboard host as described here; a registered operator `hostId` targets that operator browser host as specified in `browser-operator-host`, with the same `cdpUrl` form. The response is the only way to obtain a `cdpUrl`; no lookup endpoint SHALL exist. `POST /api/browser/disconnect?instanceId=<id>` SHALL close that relay instance, detaching its tabs; `instanceId` is required. `PUT /api/browser/enabled {enabled}` SHALL write `plugins.browser.enabled` and, when false, close every instance before responding.

#### Scenario: Zero-dialog token configured

- **WHEN** the profile config has `zeroDialog: true` and a stored token matching the extension's token, and the agent calls `connect`
- **THEN** the extension SHALL attach without a user dialog and `connect` SHALL resolve with a `cdpUrl` on `127.0.0.1` and an `instanceId`

#### Scenario: Default dialog flow

- **WHEN** `zeroDialog` is unset and the agent calls `connect`
- **THEN** the extension SHALL show its Allow/Reject dialog; on Allow `connect` resolves, on Reject or no answer within 60 s `connect` returns 504 and the guid expires

#### Scenario: Token mismatch

- **WHEN** the stored token does not match the extension's token
- **THEN** the extension SHALL refuse inside its own page (nothing reaches the relay), no tab group SHALL be created, and `connect` SHALL return 504 after 60 s exactly as for no answer; the settings section SHALL explain this outcome beside the `Zero-dialog` toggle

#### Scenario: Global kill switch

- **WHEN** `plugins.browser.enabled` is `false` (the plugin remains loaded; this is plugin config, distinct from the loader-level plugin toggle)
- **THEN** every relay endpoint SHALL reject upgrades with 403, every `/api/browser/*` write except `PUT /api/browser/enabled` SHALL return 403, and live instances SHALL have been closed before the `PUT` that flipped the flag responded

#### Scenario: Omitted host keeps today's behaviour

- **WHEN** an agent calls `connect` without `host`
- **THEN** the dashboard host's Chrome SHALL be opened and no `browser_host_*` message SHALL be sent to any client

### Requirement: Screencast tap for dashboard viewers

While an instance is live, dashboard clients on the existing gated `/ws` browser gateway MAY subscribe with `browser_relay_subscribe {instanceId, tabId}`, where `tabId` is a Chrome tab id from `browser_relay_status`. The relay SHALL then:
- start a screencast on that tab;
- send each frame **only to subscribed sockets** as `browser_relay_frame {instanceId, tabId, jpegBase64, metadata}`, never broadcast, except a socket that subscribed with `local: true` as the carrier of the instance's operator browser host, which receives no frames (see `browser-operator-host` "Local frame viewers");
- acknowledge frames immediately;
- skip frames per viewer whose socket buffer exceeds a threshold, rather than stalling the CDP client.

There is no cap on viewers per tab; backpressure is the only regulator.

`browser_relay_status` SHALL be broadcast on every instance/tab change and on every audit append, coalesced to at most one per 500 ms. It SHALL carry `{instances: [{instanceId, profileDirectory, host, state, tabs: [{tabId, title, url, state}]}], auditSeq}`, where `host` is `"dashboard"` (including the test-only fake instance) or the operator `hostId`.

If the CDP client already runs its own screencast on the requested tab, the subscribe SHALL be refused with tab state `client-screencast-active`, and the client's screencast SHALL be left untouched. While a tap is active, `Page.screencastFrame` events SHALL NOT be forwarded to the CDP client, and a CDP client's own `Page.startScreencast` SHALL be denied.

#### Scenario: Viewer subscribes while agent drives

- **WHEN** a viewer subscribes and the agent continues sending CDP commands
- **THEN** the viewer SHALL receive frames at the tab's repaint rate (≈10 fps on a repainting page) and the agent's command latency SHALL not degrade by more than one frame interval

#### Scenario: No frames arrive

- **WHEN** a subscribed tab emits no screencast frame for 2 s (hidden tab, or a visible tab that is not repainting)
- **THEN** the relay SHALL emit `browser_relay_status` with that tab's state `"no-frames"`; on `browser_relay_input {kind: "bringToFront"}` the relay SHALL issue `Page.bringToFront`, after which a hidden tab SHALL resume emitting frames on its next repaint

#### Scenario: Frames go only to subscribers

- **WHEN** two dashboard clients are connected to `/ws` and only one has subscribed to a tab
- **THEN** only the subscribed client SHALL receive `browser_relay_frame` messages

#### Scenario: Viewer input is allowlisted

- **WHEN** a viewer sends `browser_relay_input` of kind `mouse`, `key`, `scroll`, `bringToFront` or `resize`, with `mouse`/`scroll` coordinates normalized to `[0,1]` of the frame
- **THEN** the relay SHALL:
  - scale `mouse`/`scroll` coordinates by the last frame's `metadata.deviceWidth/deviceHeight`;
  - translate `mouse` to `Input.dispatchMouseEvent`, `key` to `Input.dispatchKeyEvent`, `scroll` to `Input.synthesizeScrollGesture` and `bringToFront` to `Page.bringToFront`;
  - translate `resize {width, height}` (CSS pixels) to `Emulation.setDeviceMetricsOverride`, clamped to 320–3840 × 240–2160, unless the CDP client currently holds a device-metrics override on that tab (set and not yet cleared by the CDP client), in which case the resize SHALL be refused with an audit entry and reason `agent-emulation-active`, and the tab's status SHALL carry `agentEmulation: true`;
  - drop any other kind, out-of-range coordinates, or a non-numeric `resize`, with an audit entry;
  - never let the viewer reach `Runtime.*`.

#### Scenario: Two tabs viewed at once

- **WHEN** viewers subscribe to two different tabs of the same instance
- **THEN** each tab SHALL have its own screencast, frames SHALL be tagged with their `tabId`, and only that tab's `Page.screencastFrame` events SHALL be filtered from the CDP client

#### Scenario: Last viewer leaves

- **WHEN** the last subscribed viewer for a tab unsubscribes or disconnects
- **THEN** the relay SHALL stop the screencast on that tab and SHALL clear any device-metrics override the relay set on it

#### Scenario: Instance closes with a viewer override in place
- **WHEN** a viewer-requested resize is in effect and the instance closes for any reason
- **THEN** the relay SHALL attempt to clear that override before closing the sockets

#### Scenario: Agent owns emulation
- **WHEN** the CDP client has sent `Emulation.setDeviceMetricsOverride` on a tab and a viewer then sends `resize` for it
- **THEN** the relay SHALL NOT send any emulation command for the viewer, SHALL audit the refusal with reason `agent-emulation-active`, and the tab's status SHALL carry `agentEmulation: true`

#### Scenario: Agent releases emulation
- **WHEN** the CDP client then sends `Emulation.clearDeviceMetricsOverride` on that tab
- **THEN** the tab's status SHALL no longer carry `agentEmulation: true` and viewer `resize` SHALL be applied again
