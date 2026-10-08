## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Audit trail

The relay SHALL record, per guid, an in-memory ring (≥ 500 entries) of `{ts, profile, kind, detail}` for these kinds: `attach`, `detach`, `navigate`, `createTarget`, `denied`, `dropped`, `open`, `viewer-subscribe`, `viewer-subscribe-refused` and `viewer-input`. `detail` SHALL carry URLs (redacted per "Extension-internal URLs and the connect tab never reach a viewer") and method names only. It SHALL never carry request/response payloads, the guid or the token.

#### Scenario: Audit read

- **WHEN** an authenticated dashboard client calls `GET /api/browser/audit?profile=<profileDirectory>`
- **THEN** the response SHALL list entries newest-first (each tagged with `instanceId`) with no payload bodies and no guid/token values

#### Scenario: Acknowledged-and-dropped verb is distinguishable from a denial

- **WHEN** the relay acknowledges and drops `Browser.setDownloadBehavior`
- **THEN** the audit entry SHALL have kind `dropped`, not `denied`
