# browser-relay Specification

## Purpose
Lets a pi session drive the user's real, logged-in Chrome profile over CDP by relaying between the Playwright Chrome Extension (which dials the dashboard) and a CDP client (`agent-browser connect`), with per-session tab-group isolation, a relay-side verb deny-list, an audit trail, and a screencast tap that streams frames to dashboard viewers.

## Requirements

### Requirement: Extension dials in on a per-connection relay endpoint

The dashboard SHALL expose a WebSocket endpoint `/ws/browser-ext/<guid>` that accepts exactly one connection from the pinned Playwright Chrome Extension per guid. The guid SHALL be at least 128 bits of randomness, minted server-side per connect request, never written to logs, and never persisted. A guid not claimed by an extension socket before the connect timeout (60 s) SHALL expire.

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

### Requirement: Relay endpoints are loopback-only

Both `/ws/browser-ext/<guid>` and `/ws/browser-cdp/<guid>` SHALL be admitted only for genuinely-local peers presenting a live guid in the path; the guid is the sole credential. `/ws/browser-cdp/<guid>` SHALL additionally reject any upgrade that carries an `Origin` header (web content always sends one; CDP clients never do). They SHALL NOT be reachable through the tunnel, SHALL NOT accept single-use WebSocket tickets, SHALL NOT be admitted by trusted-CIDR bypass, and SHALL NOT accept a dashboard session cookie or the local IPC token in place of the guid.

#### Scenario: Web page with its own cdpUrl

- **WHEN** a loopback web page obtains a valid `cdpUrl` and opens a WebSocket to it (the browser attaches `Origin`)
- **THEN** the upgrade SHALL be rejected with HTTP 403

#### Scenario: Remote peer

- **WHEN** an upgrade arrives on either relay endpoint from a non-loopback peer, or via the tunnel Host, or presenting a `ticket`
- **THEN** the upgrade SHALL be rejected with HTTP 403 and a `[ws-gate]` log line naming scope and peer

### Requirement: CDP client attaches on the paired endpoint

The dashboard SHALL expose `/ws/browser-cdp/<guid>` speaking Chrome DevTools Protocol such that `agent-browser connect ws://127.0.0.1:<port>/ws/browser-cdp/<guid>` (Playwright `connectOverCDP`, which sends no custom headers) succeeds once the extension socket for that guid is established. Exactly one CDP client per guid SHALL be allowed.

#### Scenario: Playwright attaches after extension handshake

- **WHEN** the extension socket for `<guid>` has completed its initial handshake and a CDP client connects to `/ws/browser-cdp/<guid>` from loopback
- **THEN** `Target.setAutoAttach` SHALL answer with one attached target per tab in the session's tab group and `Browser.getVersion` SHALL succeed

#### Scenario: CDP client before extension

- **WHEN** a CDP client connects for a guid whose extension socket is not yet established
- **THEN** the relay SHALL hold CDP traffic until the extension handshake completes or a 30 s timeout closes the CDP socket with reason `Extension not connected`

#### Scenario: Second CDP client

- **WHEN** a second CDP client connects for a guid already holding a CDP client
- **THEN** the second socket SHALL be closed with code 1000 and reason `Another CDP client already connected`

### Requirement: Per-session isolation via tab groups

Each guid SHALL map to its own tab group inside the target Chrome profile. Tabs created through one guid SHALL NOT be visible as targets to a CDP client attached to a different guid. Each live instance SHALL expose a non-secret `instanceId` (distinct from the guid, unusable to open any socket) for UI and audit addressing.

#### Scenario: Two sessions, one profile

- **WHEN** two pi sessions each obtain a guid for the same profile and each creates a tab
- **THEN** each CDP client SHALL see only its own tab in `Target.getTargets` and the profile SHALL show two distinct coloured tab groups

#### Scenario: Profile cannot host a second concurrent instance

- **WHEN** the extension refuses a second concurrent relay connection from the same profile (behaviour established by the pre-implementation spike)
- **THEN** `POST /api/browser/connect` for a profile that already has a live instance SHALL return 409 `{reason: "busy", instanceId}`, and the first instance SHALL be unaffected

#### Scenario: CDP client disconnects

- **WHEN** the CDP client socket for a guid closes for any reason
- **THEN** the relay SHALL close the instance: the extension socket closes, all controlled tabs are detached, the tab group is released, and the guid expires

#### Scenario: CDP client never attaches

- **WHEN** the extension handshake completed but no CDP client attached within 30 s
- **THEN** the relay SHALL close the instance exactly as above and record an audit entry of kind `detach` with detail `no-cdp-client`

#### Scenario: Last controlled tab closed

- **WHEN** the user closes the last tab in a guid's tab group
- **THEN** the extension socket SHALL close with reason `All controlled tabs detached`, the CDP socket SHALL close with reason `Extension disconnected`, and the guid SHALL expire

### Requirement: Relay-side CDP deny-list

The relay SHALL reject the following CDP methods from the CDP client with a CDP error response (`code: -32000`, message `Denied by dashboard relay policy: <method>`) and SHALL NOT forward them to the extension: `Storage.getCookies`, `Network.getAllCookies`, `Network.getCookies`, `Browser.setDownloadBehavior`; and `Page.navigate` / `Target.createTarget` whose URL scheme is `file:`, `javascript:`, `data:` or `blob:`, or — when the profile's `allowedDomains` is non-empty — whose URL has no host or a host outside that list. An `allowedDomains` entry matches its exact host; an entry with a leading dot (`.github.com`) matches the bare host and every subdomain (`github.com`, `api.github.com`), never a suffix-lookalike (`github.com.evil.io`). Matching is case-insensitive on the host only (port and path ignored). `allowedDomains` is a navigation guardrail on those two verbs only — it does not prevent navigation via `Runtime.evaluate`, link clicks, or HTTP redirects, and the settings help text SHALL say so.

#### Scenario: Cookie exfiltration attempt

- **WHEN** the CDP client sends `Network.getAllCookies` or `Network.getCookies`
- **THEN** the relay SHALL answer with the CDP error above, SHALL append an audit entry with kind `denied`, and SHALL NOT forward the command

#### Scenario: Navigation outside allowedDomains

- **WHEN** the profile config sets `allowedDomains: ["github.com"]` and the CDP client sends `Page.navigate {url: "https://example.com"}` (or `https://api.github.com`, since the entry has no leading dot)
- **THEN** the relay SHALL answer with the CDP error and the tab SHALL NOT navigate

#### Scenario: Leading-dot entry admits subdomains

- **WHEN** `allowedDomains: [".github.com"]` and the CDP client navigates to `https://api.github.com/x`
- **THEN** the relay SHALL forward it; `https://github.com.evil.io` SHALL still be denied

#### Scenario: Ordinary automation is untouched

- **WHEN** the CDP client sends `Runtime.evaluate`, `DOM.getDocument`, `Input.dispatchMouseEvent`, or `Page.navigate` to an allowed https URL
- **THEN** the relay SHALL forward the command unchanged and return the extension's response

### Requirement: Audit trail

The relay SHALL record, per guid, an in-memory ring (≥ 500 entries) of `{ts, profile, kind, detail}` for kinds `attach`, `detach`, `navigate`, `createTarget`, `denied`, `viewer-subscribe`, `viewer-input`. `detail` SHALL carry URLs and method names only — never request/response payloads, never the guid or token.

#### Scenario: Audit read

- **WHEN** an authenticated dashboard client calls `GET /api/browser/audit?profile=<profileDirectory>`
- **THEN** the response SHALL list entries newest-first (each tagged with `instanceId`) with no payload bodies and no guid/token values

### Requirement: Profile discovery and capability

`GET /api/browser/status` SHALL return `{enabled, canOpenChrome}` where `canOpenChrome` is true iff the host can open a URL in a named Chrome profile. `GET /api/browser/profiles` SHALL list Chrome profiles from the host's `Local State` profile cache with `{profileDirectory, label, email?, installed, hasToken, zeroDialog, instances: [{instanceId, tabs: [{tabId, title, url}]}]}` keyed by `profileDirectory` (labels are user-editable and may duplicate), where `installed` is true iff the pinned extension directory exists under that profile and `instances` lists live relay instances (empty = not connected). When the Chrome user-data directory or `Local State` is absent or unparseable, the response SHALL be 200 with a single synthetic row `{profileDirectory: "Default", label: "Default", installed: <dir check>, …}` and a `warning` string naming the path.

#### Scenario: Extension absent in a profile

- **WHEN** the extension directory does not exist under `<profileDirectory>/Extensions/`
- **THEN** the profile row SHALL report `installed: false` and `POST /api/browser/connect` for it SHALL return 409 `{reason: "not-installed"}` with a message pointing at the Web Store install

#### Scenario: Host cannot open Chrome

- **WHEN** the host has no system-open capability (headless / container)
- **THEN** `status.canOpenChrome` SHALL be `false` and `POST /api/browser/connect` SHALL return 503

### Requirement: Connect and CDP-URL lifecycle

`POST /api/browser/connect?profile=<profileDirectory>` SHALL mint a guid, open the extension's `connect.html` in that profile with `protocolVersion=2` and, when the profile config sets `zeroDialog: true` and a token is stored, `token=<token>`, and return `{cdpUrl, instanceId}` once the extension handshake completes (timeout 60 s → 504 and the guid expires). The response is the only way to obtain a `cdpUrl`; no lookup endpoint SHALL exist. `POST /api/browser/disconnect?instanceId=<id>` SHALL close that relay instance, detaching its tabs; `instanceId` is required. `PUT /api/browser/enabled {enabled}` SHALL write `plugins.browser.enabled` and, when false, close every instance before responding.

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

### Requirement: Screencast tap for dashboard viewers

While an instance is live, dashboard clients on the existing gated `/ws` browser gateway MAY subscribe with `browser_relay_subscribe {instanceId, tabId}` where `tabId` is a Chrome tab id from `browser_relay_status`. The relay SHALL then start a screencast on that tab, send each frame **only to subscribed sockets** as `browser_relay_frame {instanceId, tabId, jpegBase64, metadata}` (never broadcast), acknowledge frames immediately, and skip frames per viewer whose socket buffer exceeds a threshold rather than stalling the CDP client. There is no cap on viewers per tab; backpressure is the only regulator. `browser_relay_status` SHALL be broadcast on every instance/tab change and on every audit append (coalesced to at most one per 500 ms) and carry `{instances: [{instanceId, profileDirectory, state, tabs: [{tabId, title, url, state}]}], auditSeq}`. If the CDP client already runs its own screencast on the requested tab, the subscribe SHALL be refused with tab state `client-screencast-active` and the client's screencast SHALL be left untouched. `Page.screencastFrame` events SHALL NOT be forwarded to the CDP client while a tap is active, and a CDP client's own `Page.startScreencast` SHALL be denied while a tap is active.

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

- **WHEN** a viewer sends `browser_relay_input` of kind `mouse`, `key`, `scroll`, or `bringToFront`, with `mouse`/`scroll` coordinates normalized to `[0,1]` of the frame
- **THEN** the relay SHALL scale coordinates by the last frame's `metadata.deviceWidth/deviceHeight` and translate to `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.synthesizeScrollGesture`, or `Page.bringToFront` respectively; any other kind, or out-of-range coordinates, SHALL be dropped with an audit entry and the viewer SHALL never reach `Runtime.*`

#### Scenario: Two tabs viewed at once

- **WHEN** viewers subscribe to two different tabs of the same instance
- **THEN** each tab SHALL have its own screencast, frames SHALL be tagged with their `tabId`, and only that tab's `Page.screencastFrame` events SHALL be filtered from the CDP client

#### Scenario: Last viewer leaves

- **WHEN** the last subscribed viewer for a tab unsubscribes or disconnects
- **THEN** the relay SHALL stop the screencast on that tab

### Requirement: Test-only fake instance

When the server starts with `PI_BROWSER_RELAY_FAKE=1`, the plugin SHALL register one synthetic instance (`profileDirectory: "Fake"`, one tab `{tabId: 1, title: "Fake tab", url: "https://fake.test/"}`) that emits a 64×64 JPEG frame every 100 ms to subscribers, echoes viewer input into its audit ring, and needs no Chrome, extension, or relay socket. The env var SHALL be ignored (no fake) when unset.

#### Scenario: Fake instance in the docker harness

- **WHEN** the harness runs with `PI_BROWSER_RELAY_FAKE=1` and a client subscribes to `{instanceId: <fake>, tabId: 1}`
- **THEN** it SHALL receive ≥ 5 `browser_relay_frame` messages within 1 s and a `browser_relay_status` listing the fake instance

### Requirement: Debugger conflict is surfaced

When the extension reports a detach with reason `canceled_by_user` (user opened DevTools on a controlled tab), the relay SHALL emit `browser_relay_status {state: "detached", reason: "devtools"}` to viewers and answer subsequent CDP commands for that tab with a CDP error until the extension reattaches.

#### Scenario: User opens DevTools

- **WHEN** DevTools is opened on a controlled tab
- **THEN** viewers SHALL see the detached status within 1 s and the CDP client SHALL receive `Target detached: devtools` errors for that tab
