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

The relay SHALL reject the following CDP methods from the CDP client with a CDP error response (`code: -32000`, message `Denied by dashboard relay policy: <method>`), and SHALL NOT forward them to the extension:
- `Storage.getCookies`, `Network.getAllCookies` and `Network.getCookies`;
- `Page.navigate` and `Target.createTarget` whose URL scheme is `file:`, `javascript:`, `vbscript:`, `data:` or `blob:`;
- when the profile's `allowedDomains` is non-empty, `Page.navigate` and `Target.createTarget` whose URL has no host, or a host outside that list.

The relay SHALL answer `Browser.setDownloadBehavior` locally with an empty success result. It SHALL NOT forward it, so the profile's download behavior is never changed by the CDP client. It SHALL append an audit entry of kind `dropped` naming the method.

Matching rules for `allowedDomains`:
- An entry matches its exact host.
- An entry with a leading dot (`.github.com`) matches the bare host and every subdomain (`github.com`, `api.github.com`), never a suffix lookalike (`github.com.evil.io`).
- Matching is case-insensitive on the host only; port and path are ignored.

`allowedDomains` is a navigation guardrail on those two verbs only. It does not prevent navigation via `Runtime.evaluate`, link clicks or HTTP redirects, and the settings help text SHALL say so.

#### Scenario: Cookie exfiltration attempt

- **WHEN** the CDP client sends `Network.getAllCookies` or `Network.getCookies`
- **THEN** the relay SHALL answer with the CDP error above, SHALL append an audit entry with kind `denied`, and SHALL NOT forward the command

#### Scenario: Download behavior is acknowledged but not applied

- **WHEN** a Playwright `connectOverCDP` client sends `Browser.setDownloadBehavior` during its handshake
- **THEN** the relay SHALL answer success without forwarding it, the handshake SHALL complete, and the audit SHALL gain a `dropped` row naming `Browser.setDownloadBehavior`

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

The relay SHALL record, per guid, an in-memory ring (≥ 500 entries) of `{ts, profile, kind, detail}` for these kinds: `attach`, `detach`, `navigate`, `createTarget`, `denied`, `dropped`, `open`, `viewer-subscribe`, `viewer-subscribe-refused` and `viewer-input`. `detail` SHALL carry URLs (redacted per "Extension-internal URLs and the connect tab never reach a viewer") and method names only. It SHALL never carry request/response payloads, the guid or the token.

#### Scenario: Audit read

- **WHEN** an authenticated dashboard client calls `GET /api/browser/audit?profile=<profileDirectory>`
- **THEN** the response SHALL list entries newest-first (each tagged with `instanceId`) with no payload bodies and no guid/token values

#### Scenario: Acknowledged-and-dropped verb is distinguishable from a denial

- **WHEN** the relay acknowledges and drops `Browser.setDownloadBehavior`
- **THEN** the audit entry SHALL have kind `dropped`, not `denied`

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

While an instance is live, dashboard clients on the existing gated `/ws` browser gateway MAY subscribe with `browser_relay_subscribe {instanceId, tabId}`, where `tabId` is a Chrome tab id from `browser_relay_status`. The relay SHALL then:
- start a screencast on that tab;
- send each frame **only to subscribed sockets** as `browser_relay_frame {instanceId, tabId, jpegBase64, metadata}`, never broadcast;
- acknowledge frames immediately;
- skip frames per viewer whose socket buffer exceeds a threshold, rather than stalling the CDP client.

There is no cap on viewers per tab; backpressure is the only regulator.

`browser_relay_status` SHALL be broadcast on every instance/tab change and on every audit append, coalesced to at most one per 500 ms. It SHALL carry `{instances: [{instanceId, profileDirectory, state, tabs: [{tabId, title, url, state}]}], auditSeq}`.

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

### Requirement: Vendored relay resolves without alias configuration

Every import in `relay/vendor/playwright-core/**` SHALL be a package-relative
path, a Node builtin, or a dependency declared in the plugin's
`package.json`. No import SHALL rely on `tsconfig` `paths`, a bundler
`resolve.alias`, the `JITI_TSCONFIG_PATHS` environment variable, or the
process working directory.

The plugin SHALL therefore load identically in a monorepo checkout, an npm
global install, the managed `~/.pi-dashboard/node_modules` install, the
Electron bundled server, and the Docker image.

#### Scenario: Plugin loads from an install with no monorepo tsconfig
- **GIVEN** the plugin package is installed outside any monorepo, with no `tsconfig.base.json` reachable from it
- **AND** `JITI_TSCONFIG_PATHS` is unset
- **WHEN** the plugin loader imports the plugin's server entry
- **THEN** the import SHALL succeed and `typeof mod.default` SHALL be `"function"`
- **AND** the resolved module path SHALL be inside that install, not inside any monorepo checkout on the host

#### Scenario: Vendored sources carry no unresolvable bare specifier
- **WHEN** the import statements under `relay/vendor/playwright-core/**` are enumerated
- **THEN** every bare specifier SHALL be a Node builtin or a declared dependency
- **AND** a specifier under any playwright-internal namespace (for example `@isomorphic/`, `@utils/`, `@protocol/`, `@injected/`) SHALL fail the check

#### Scenario: Both patched vendored modules are exercised
- **WHEN** the install-load verification runs
- **THEN** it SHALL import `cdpRelay.js` in addition to the plugin server entry, because the runtime chain reaches only `cdpRelayV2.js`

#### Scenario: Server boot loads the browser plugin
- **GIVEN** a dashboard server cold-started through its launcher with `JITI_TSCONFIG_PATHS` explicitly unset
- **AND** the `browser` plugin enabled in config
- **WHEN** plugin loading completes
- **THEN** the log SHALL contain `Loaded plugin "browser"` and no `Failed to load plugin "browser"`

### Requirement: Vendored tree integrity is provenance-aware

Files under `relay/vendor/` SHALL NOT be hand-edited. `playwright-core/**` is
produced by copying from the commit recorded in `vendor/NOTICE` and then
applying `scripts/patch-vendor-specifiers.mjs`, which SHALL be idempotent.

`src/server/__tests__/vendor-hashes.json` SHALL record a provenance `kind`
per file, because the tree is not uniformly upstream:

- `upstream-verbatim` — carries `upstream` (bytes at `upstreamCommit`) and
  `patched` (bytes on disk).
- `authored` — carries `patched` only. `playwright-core/src/server/registry/index.ts`
  and `shims/wsServer.ts` replace upstream modules and have no upstream
  counterpart; recording an `upstream` hash for them would be false.

`shims/**` SHALL be covered by the manifest, since every rewritten import
resolves into that directory.

The integrity test SHALL fail on drift in any `patched` hash, on an added or
removed file, and on an entry missing a key its `kind` requires. Verification
that a refresh faithfully reproduced `upstreamCommit` SHALL be performed by
`scripts/refresh-vendor.mjs` at refresh time against a fetch of that commit —
a test cannot establish it, because regenerating both hashes from one tree is
circular.

Modified vendored files SHALL carry an in-file notice of modification
(Apache-2.0 §4(b)); `vendor/NOTICE` SHALL list them in a Modifications
section and SHALL NOT continue to list them as verbatim (§4(d)).

#### Scenario: Hand-edit is rejected
- **WHEN** a file under `relay/vendor/` is edited by hand
- **THEN** the integrity test SHALL fail on its `patched` hash

#### Scenario: Refresh that skips the patch script is rejected
- **GIVEN** the vendored tree was re-copied from upstream
- **WHEN** `scripts/patch-vendor-specifiers.mjs` was not run
- **THEN** the specifier guard SHALL fail

#### Scenario: Unfaithful refresh is rejected at refresh time
- **GIVEN** a file copied from a revision other than `upstreamCommit`
- **WHEN** `scripts/refresh-vendor.mjs` runs
- **THEN** it SHALL fail on that file's recorded `upstream` hash before patching

#### Scenario: Authored shim is not claimed as upstream
- **WHEN** the manifest is validated
- **THEN** `playwright-core/src/server/registry/index.ts` SHALL have `kind: "authored"` and SHALL NOT carry an `upstream` hash

#### Scenario: Patch script is idempotent
- **WHEN** `scripts/patch-vendor-specifiers.mjs` runs twice in a row
- **THEN** the second run SHALL leave the tree byte-identical, including the in-file modification notice

### Requirement: Tab viewability is reported in status

`browser_relay_status` SHALL report a tab that the relay knows about but that has no debugger session (for example, a tab the agent has not attached to) as `state: "detached"` with `reason: "no-session"`, never as `live`. The extension's own connect page SHALL NOT be listed at all. When a listed tab later gains a debugger session, the relay SHALL broadcast `browser_relay_status` with the tab's new state. `reason: "devtools"` keeps its existing meaning and takes precedence over `no-session`.

#### Scenario: Unattached tab is not reported live

- **WHEN** a connected instance knows a tab, other than its connect page, that has no debugger session
- **THEN** `browser_relay_status` SHALL list that tab with `state: "detached"` and `reason: "no-session"`

#### Scenario: Extension connect page is not reported live

- **WHEN** a connected instance's only known tab is the extension's connect page
- **THEN** `browser_relay_status` SHALL list that instance with an empty tab list

#### Scenario: Tab becomes viewable

- **WHEN** the agent attaches to a previously `no-session` tab
- **THEN** the relay SHALL broadcast `browser_relay_status` listing that tab in a state other than `detached/no-session`

#### Scenario: DevTools reason wins

- **WHEN** a tab was detached by the user opening DevTools and has no session
- **THEN** the tab SHALL be reported with `reason: "devtools"`

### Requirement: Refused viewer subscribes are audited

When a `browser_relay_subscribe` for a known instance is refused (tab has no debugger session, tab detached by DevTools, or the CDP client owns the tab's screencast), the relay SHALL append an audit entry of kind `viewer-subscribe-refused` whose detail names the tab and the refusal reason, SHALL NOT start a screencast, and SHALL keep the viewer unsubscribed.

#### Scenario: Subscribe to a no-session tab

- **WHEN** a viewer subscribes to a tab with no debugger session
- **THEN** no `Page.startScreencast` SHALL be sent and the profile's audit SHALL gain a `viewer-subscribe-refused` row with reason `no-session`

### Requirement: Standard CDP clients attach to the relay

`agent-browser connect <cdpUrl>` and Playwright `chromium.connectOverCDP(cdpUrl)` SHALL both complete their connection handshake against a connected instance, including when the instance has no attached tab yet. Both SHALL then be able to create, navigate and drive tabs inside the instance's tab group.

To this end, the relay SHALL answer `Target.setDiscoverTargets` locally with an empty success result and never forward it. While discovery is enabled:
- it SHALL announce each tab that has a debugger session exactly once with `Target.targetCreated`, carrying that tab's real target info;
- it SHALL announce that tab's end with `Target.targetDestroyed`, whether discovery was enabled before or after auto-attach;
- it SHALL never announce a tab without a session;
- it SHALL never announce child sessions (workers, frames) as targets;
- `{discover: false}` SHALL stop announcements.

The extension's own connect page SHALL never be exposed to the CDP client: no attach, detach or discovery event SHALL describe it, and commands addressed to it SHALL fail with a CDP error.

A browser-level command the relay cannot serve SHALL fail with a CDP error with `code: -32000`, and SHALL NOT close the instance.

#### Scenario: agent-browser connects
- **WHEN** a connected instance has no attached tab and `agent-browser connect <cdpUrl>` is run
- **THEN** the command SHALL succeed, and a following `agent-browser open https://example.com` SHALL create and navigate a tab inside the relay instance's tab group, not in a separately launched browser

#### Scenario: Playwright connects
- **WHEN** `chromium.connectOverCDP(cdpUrl)` is called against a connected instance
- **THEN** the returned browser SHALL expose a context in which a new page can navigate to an allowed URL

#### Scenario: Discovery after auto-attach does not duplicate
- **WHEN** a client enables auto-attach, a tab attaches, and the client then enables discovery
- **THEN** that tab SHALL be announced by `Target.targetCreated` exactly once

#### Scenario: Connect page is never announced
- **WHEN** discovery is enabled while the extension's connect page is open
- **THEN** no `Target.targetCreated` event SHALL describe that page

### Requirement: Extension-internal URLs and the connect tab never reach a viewer

Every payload sent to dashboard viewers SHALL:
- omit the extension's own connect page from tab lists;
- strip the query string and fragment from any other `chrome-extension:` URL;
- contain no pairing token, no relay guid and no `mcpRelayUrl` parameter.

Viewer-facing payloads are the `/ws` browser-relay messages (including frames), and `/api/browser/*` responses other than the `connect` response, whose `cdpUrl` is returned only to its caller. Audit `detail` SHALL obey the same rule. The relay SHALL refuse `browser_relay_subscribe` and `browser_relay_input` for the extension's connect page, auditing the subscribe refusal with reason `extension-page`, so no frame of that page reaches a viewer.

#### Scenario: Connected instance seen from the LAN
- **WHEN** a dashboard client on another host reads `GET /api/browser/profiles`, `GET /api/browser/audit` and the `browser_relay_status` stream while an instance is connected
- **THEN** none of them SHALL contain `token=`, `mcpRelayUrl` or the guid, and no tab list SHALL include the extension's connect page

#### Scenario: Subscribing to the connect page is refused
- **WHEN** a viewer sends `browser_relay_subscribe` naming the tab id of the extension's connect page
- **THEN** no frame SHALL be sent, no screencast SHALL start, and the audit SHALL gain a `viewer-subscribe-refused` entry with reason `extension-page`

### Requirement: Tab title and URL track navigation

The relay SHALL update a tab's reported `title` and `url` after the tab's main frame navigates or finishes loading, whatever caused the navigation (a CDP command, a link click or a redirect). The relay observes this on the tab's debugger session once the CDP client has enabled page events. The relay SHALL also refresh them when a viewer subscribes. A change SHALL be broadcast in `browser_relay_status`, subject to the existing 500 ms coalescing. Metadata for a removed tab SHALL be discarded.

#### Scenario: Navigation updates status
- **WHEN** the agent navigates tab 42 to `https://example.com/`
- **THEN** a subsequent `browser_relay_status` SHALL report tab 42 with `url: "https://example.com/"` and `title: "Example Domain"`

#### Scenario: Link click updates status
- **WHEN** a viewer's click on a link makes tab 42 navigate, without any CDP navigation command
- **THEN** `browser_relay_status` SHALL report the new URL and title

### Requirement: Agent-initiated open announcement

The browser plugin SHALL provide a pi tool `browser_show_in_pane {instanceId, tabId?}` to agent sessions.

When invoked from pi session `S`, the plugin server SHALL resolve the tab (when `tabId` is omitted, the instance's most recently attached tab other than the connect page; `no-tab` when none). It SHALL then ask the host to open `browser:<instanceId>:<tabId>` for session `S` (see `editor-pane-plugin-tabs`). `S` SHALL be taken from the requesting session's own connection, never from the tool arguments.

The tool SHALL return an error result naming the cause when the relay is disabled, when the instance or tab is unknown, or when the same session already had a `browser_show_in_pane` open accepted for the same instance within the last 5 s (`rate-limited`). Opens performed by `browser_await_human` SHALL NOT be rate-limited. Every invocation SHALL append an audit entry of kind `open`, accepted or refused.

#### Scenario: Agent shows its browser tab
- **WHEN** session `S` calls `browser_show_in_pane {instanceId: "inst-1", tabId: 42}` and the instance lists tab 42
- **THEN** connected clients SHALL receive `editor_tab_open {sessionId: "S", path: "browser:inst-1:42"}`, the tool SHALL succeed, and the audit SHALL gain an `open` entry

#### Scenario: Session id cannot be spoofed
- **WHEN** session `S` calls the tool with arguments that also contain `sessionId: "T"`
- **THEN** the broadcast SHALL carry `sessionId: "S"`

#### Scenario: Takeover is never rate-limited
- **WHEN** session `S` calls `browser_show_in_pane` and then, within 5 s, `browser_await_human` for the same instance
- **THEN** both opens SHALL be broadcast

#### Scenario: Relay disabled
- **WHEN** `plugins.browser.enabled` is false and the tool is called
- **THEN** the tool SHALL return an error result naming `disabled` and nothing SHALL be broadcast

#### Scenario: Repeated opens are rate-limited
- **WHEN** session `S` calls the tool twice for `inst-1` within 5 s
- **THEN** the second call SHALL return `rate-limited`, nothing further SHALL be broadcast, and the audit SHALL record the refusal

#### Scenario: Unknown tab
- **WHEN** the tool is called for a tab the instance does not list
- **THEN** the tool SHALL return an error result naming the unknown tab, nothing SHALL be broadcast, and the audit SHALL gain an `open` entry recording the refusal
