## MODIFIED Requirements

### Requirement: Per-session isolation via tab groups

Each guid of an extension-backed Chrome profile SHALL map to its own tab group inside that profile. The dedicated profile has no tab groups; it isolates sessions by serving one CDP client at a time (see dedicated-agent-browser). Tabs created through one guid SHALL NOT be visible as targets to a CDP client attached to a different guid. Each live instance SHALL expose a non-secret `instanceId` (distinct from the guid, unusable to open any socket) for UI and audit addressing.

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
- when the effective allowed-domains list is non-empty, `Page.navigate` and `Target.createTarget` whose URL has no host, or a host outside that list.

The effective allowed-domains list SHALL be the profile's `allowedDomains` when non-empty, otherwise the global `allowedDomains` setting. The dedicated profile SHALL use the global list.

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

#### Scenario: Global list applies when the profile sets none

- **WHEN** the global `allowedDomains` is `["github.com"]`, the profile's list is empty, and the CDP client navigates to `https://example.com`
- **THEN** the relay SHALL deny it

#### Scenario: Profile list overrides the global list

- **WHEN** the global list is `["github.com"]`, the profile's list is `["example.com"]`, and the CDP client navigates to `https://example.com`
- **THEN** the relay SHALL forward it

#### Scenario: Ordinary automation is untouched

- **WHEN** the CDP client sends `Runtime.evaluate`, `DOM.getDocument`, `Input.dispatchMouseEvent`, or `Page.navigate` to an allowed https URL
- **THEN** the relay SHALL forward the command unchanged and return the extension's response

### Requirement: Audit trail

The relay SHALL record, per guid, an in-memory ring (≥ 500 entries) of `{ts, profile, kind, detail}` for these kinds: `attach`, `detach`, `navigate`, `createTarget`, `denied`, `dropped`, `open`, `viewer-subscribe`, `viewer-subscribe-refused` and `viewer-input`. `detail` SHALL carry only URLs (redacted per "Extension-internal URLs and the connect tab never reach a viewer", and with query string and fragment removed), method names and fixed cause tokens. It SHALL never carry request/response payloads, the guid or the token.

Every detach the agent did not request SHALL produce a `detach` entry whose `detail` names the cause: `devtools` (the user opened DevTools), `extension:<reason>` (any other tab detach the extension reports, except `target_closed`, which is a normal tab close), `closed:<reason>` (the extension closed the instance, for example when all controlled tabs detached), `no-cdp-client` (no client attached in time) or `idle` (idle disconnect).

#### Scenario: Audit read

- **WHEN** an authenticated dashboard client calls `GET /api/browser/audit?profile=<profileDirectory>`
- **THEN** the response SHALL list entries newest-first (each tagged with `instanceId`) with no payload bodies and no guid/token values

#### Scenario: Acknowledged-and-dropped verb is distinguishable from a denial

- **WHEN** the relay acknowledges and drops `Browser.setDownloadBehavior`
- **THEN** the audit entry SHALL have kind `dropped`, not `denied`

#### Scenario: Extension closes the instance

- **WHEN** every controlled tab of an instance detaches and the extension closes the instance
- **THEN** the audit SHALL gain a `detach` entry with detail `closed:All controlled tabs detached` for that `instanceId` before the instance disappears from status

#### Scenario: Query strings never reach the audit

- **WHEN** the client navigates to `https://example.com/cb?code=abc#state=x`
- **THEN** the `navigate` audit entry SHALL read `https://example.com/cb`

#### Scenario: Normal tab close is not an extension detach

- **WHEN** the extension reports a tab detach with reason `target_closed`
- **THEN** no `detach` entry with detail `extension:target_closed` SHALL be appended

### Requirement: Profile discovery and capability

`GET /api/browser/status` SHALL return `{enabled, canOpenChrome, dedicated}` where `canOpenChrome` is true iff the host can open a URL in a named Chrome profile and `dedicated` is defined by the dedicated-agent-browser "Availability" requirement. `GET /api/browser/profiles` SHALL list Chrome profiles from the host's `Local State` profile cache with `{profileDirectory, label, email?, installed, passwordManagers, hasToken, zeroDialog, instances: [{instanceId, tabs: [{tabId, title, url}]}]}` keyed by `profileDirectory` (labels are user-editable and may duplicate), where `installed` is true iff the pinned extension directory exists under that profile, `passwordManagers` lists the display names of known password-manager extensions installed in that profile (empty when none), and `instances` lists live relay instances (empty = not connected). When the Chrome user-data directory or `Local State` is absent or unparseable, the response SHALL be 200 with a single synthetic row `{profileDirectory: "Default", label: "Default", installed: <dir check>, …}` and a `warning` string naming the path. The dedicated profile SHALL NOT appear in `GET /api/browser/profiles`.

#### Scenario: Extension absent in a profile

- **WHEN** the extension directory does not exist under `<profileDirectory>/Extensions/`
- **THEN** the profile row SHALL report `installed: false` and `POST /api/browser/connect` for it SHALL return 409 `{reason: "not-installed"}` with a message pointing at the Web Store install

#### Scenario: Host cannot open Chrome

- **WHEN** the host has no system-open capability (headless / container)
- **THEN** `status.canOpenChrome` SHALL be `false` and `POST /api/browser/connect` SHALL return 503

#### Scenario: Password manager detected

- **WHEN** a profile has the LastPass extension (`hdokiejnpimakedhajhdlcegeplioahd`) installed
- **THEN** its row SHALL report `passwordManagers` containing `LastPass`

### Requirement: Standard CDP clients attach to the relay

This requirement applies to extension-backed instances; dedicated-profile instances follow the dedicated-agent-browser requirement "Discovery and auto-attach in the dedicated profile".

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

### Requirement: Agent-initiated open announcement

The browser plugin SHALL provide a pi tool `browser_show_in_pane {instanceId, tabId?}` to agent sessions.

When invoked from pi session `S`, the plugin server SHALL resolve the tab (when `tabId` is omitted, the instance's most recently attached tab other than the connect page; `no-tab` when none). It SHALL then ask the host to open `browser:<instanceId>:<tabId>` for session `S` (see `editor-pane-plugin-tabs`). `S` SHALL be taken from the requesting session's own connection, never from the tool arguments.

The tool SHALL return an error result naming the cause when the relay is disabled, when the instance or tab is unknown, or when the same session already had a `browser_show_in_pane` open accepted for the same instance within the last 5 s (`rate-limited`). Opens performed by `browser_await_human` SHALL NOT be rate-limited. The automatic open performed by `browser_connect` when `openLiveViewOnConnect` is on SHALL NOT be rate-limited, SHALL NOT count toward the 5 s window, and SHALL be audited as `open` with detail `auto`. Every invocation SHALL append an audit entry of kind `open`, accepted or refused.

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

#### Scenario: Automatic live-view open does not block the agent
- **WHEN** `browser_connect` opened the first tab of `inst-1` for session `S` automatically and `S` calls `browser_show_in_pane` for `inst-1` within 5 s
- **THEN** the tool call SHALL NOT return `rate-limited`, and the audit SHALL hold one `open` entry with detail `auto` and one for the tool call

## ADDED Requirements

### Requirement: Session-aware browser_connect tool

The browser plugin SHALL provide a pi tool `browser_connect {target?}` to agent sessions, where `target` is `"@dedicated"`, `"@headless"` or a `profileDirectory`. The calling session SHALL be taken from the requesting session's own connection, never from the arguments.

The tool SHALL resolve the first target from the argument, else from the `defaultBrowser` setting (default `"@dedicated"`). When that target is unavailable, it SHALL apply the `onUnavailable` setting:
- `"ask"` (default): return an error result `{unavailable: {target, reason}, options: [{target, label, available, reason?}], attempts}` without connecting anything;
- `"next"`: try the unique sequence first target, `"@dedicated"`, the `realProfile` setting, `"@headless"`, skipping entries already tried and profile entries that are unset or not installed;
- `"stop"`: return an error result `{unavailable: {target, reason}, stopped: true, attempts}`.

A successful result SHALL name the browser used: `{browser: "dedicated" | "profile", profileDirectory?, instanceId, cdpUrl, liveView, attempts}` or, for headless, `{browser: "headless", attempts}` with no `cdpUrl`. `attempts` SHALL list each target tried with its failure reason. Profile targets connect exactly as `POST /api/browser/connect` does, including the Allow dialog and `zeroDialog`. The tool SHALL NOT route to any extension bridge other than the dashboard relay. When the live dedicated instance is held by the calling session itself, the tool SHALL close that instance and connect a new one instead of reporting `busy`.

When `openLiveViewOnConnect` is true (default), the plugin SHALL open the instance's first agent-created tab in the calling session's pane once, through the `browser_show_in_pane` open path, exempt from its rate limit, with an `open` audit entry whose detail is `auto`; the result's `liveView` SHALL be true.

The REST connect routes SHALL keep their behaviour and SHALL NOT apply these settings.

#### Scenario: Default goes to the dedicated profile

- **WHEN** `defaultBrowser` is unset and a session calls `browser_connect {}` with the dedicated profile available
- **THEN** the result SHALL be `{browser: "dedicated", instanceId, cdpUrl}`

#### Scenario: Ask on unavailable

- **WHEN** `onUnavailable` is `"ask"` and the dedicated profile is busy
- **THEN** the tool SHALL return `{unavailable: {target: "@dedicated", reason: "busy"}, options: [...]}` and SHALL NOT connect any profile

#### Scenario: Try next falls through to headless

- **WHEN** `onUnavailable` is `"next"`, the dedicated profile is unavailable and no `realProfile` is set
- **THEN** the result SHALL be `{browser: "headless", attempts: [{target: "@dedicated", reason}]}`

#### Scenario: Next with a real profile set

- **WHEN** `onUnavailable` is `"next"`, the default is `"@dedicated"`, the dedicated profile is busy, and `realProfile` is an installed profile `P`
- **THEN** the tool SHALL connect `P` and return `{browser: "profile", profileDirectory: "P", attempts: [{target: "@dedicated", reason: "busy"}]}`

#### Scenario: Same session reconnects

- **WHEN** session `S` holds the dedicated instance, lost its `cdpUrl`, and calls `browser_connect {}` again
- **THEN** the old instance SHALL close and the result SHALL carry a new `cdpUrl` for `S`

#### Scenario: Live view opens once

- **WHEN** `openLiveViewOnConnect` is true and the agent creates its first tab on the returned instance
- **THEN** the calling session's pane SHALL open that tab and the audit SHALL gain one `open` entry with detail `auto`; a second tab SHALL NOT open the pane again

### Requirement: Idle disconnect

Every relay and dedicated instance SHALL record its last activity: a CDP command sent by its client or viewer input on its tabs. An instance with a pending `browser_await_human` SHALL count as active. When `idleDisconnectMinutes` is greater than 0 (default 30), an instance idle for longer SHALL be closed, with a `detach` audit entry with detail `idle`. Closing a relay instance SHALL follow the disconnect path. Closing the dedicated instance SHALL close the client connection and the tabs that client created, and SHALL leave the dedicated Chrome running.

#### Scenario: Idle relay instance

- **WHEN** `idleDisconnectMinutes` is 1 and a relay instance's client sends nothing for more than 2 minutes
- **THEN** the instance SHALL be gone from status and the audit SHALL show `detach` with detail `idle`

#### Scenario: Waiting for the human

- **WHEN** `idleDisconnectMinutes` is 5 and the agent waits 10 minutes in `browser_await_human` for that instance
- **THEN** the instance SHALL stay connected

#### Scenario: Never

- **WHEN** `idleDisconnectMinutes` is 0
- **THEN** no instance SHALL be closed for inactivity
