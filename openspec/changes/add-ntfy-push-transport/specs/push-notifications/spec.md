## ADDED Requirements

### Requirement: ntfy transport
A token with `transport: "ntfy"` SHALL carry a topic URL `<scheme>://<host>[:port]/<topic>` as its `deviceToken` and MAY carry an `authToken`. On delivery the server SHALL POST `Content-Type: application/json` to the ntfy server root `<scheme>://<host>[:port]/` with body `{topic, title, message, priority, tags, click?}`, and SHALL send `Authorization: Bearer <authToken>` when an `authToken` is set. Mapping:
- `title` = payload `title`; `message` = payload `body`, or payload `title` when `body` is empty;
- `priority` = `4` for trigger `input` or `crash`, `3` for `turn_end`;
- `tags` = `["question"]` for `input`, `["rotating_light"]` for `crash`, `["white_check_mark"]` for `turn_end`;
- `click` = payload `absoluteUrl`, and the field SHALL be omitted when `absoluteUrl` is absent.

Delivery SHALL apply the same address policy, connection pinning, no-redirect rule, 5 s timeout and body discarding as the webhook transport. `2xx` SHALL map to `{ok: true}`. Every other status, a refused address, a network error or a timeout SHALL map to `{ok: false}`: logged, token kept, not retried, never pruned.

#### Scenario: Publish to hosted ntfy.sh
- **WHEN** session `abc-123` named `fix-login` hits the `input` trigger on its unread edge, one ntfy token `https://ntfy.sh/pi-Xk3abcdefghijklmnopqrstuv` is registered, and the base URL is `https://dash.example`
- **THEN** exactly one `POST https://ntfy.sh/` SHALL be sent with JSON containing `"topic": "pi-Xk3abcdefghijklmnopqrstuv"`, `"title": "fix-login: waiting for input"`, `"priority": 4`, `"tags": ["question"]` and `"click": "https://dash.example/session/abc-123"`

#### Scenario: Turn finished uses default priority
- **WHEN** a `turn_end` trigger is delivered to an ntfy token
- **THEN** the JSON SHALL contain `"priority": 3` and `"tags": ["white_check_mark"]`

#### Scenario: Empty body falls back to the title
- **WHEN** the payload `body` is empty
- **THEN** the JSON `message` SHALL equal the payload `title`

#### Scenario: No base URL omits click
- **WHEN** the payload has no `absoluteUrl`
- **THEN** the JSON SHALL NOT contain a `click` key

#### Scenario: Protected topic on a self-hosted server
- **WHEN** an ntfy token `http://192.168.1.20:8080/pi-home` with `authToken` `tk_secret` is delivered to
- **THEN** the request SHALL be `POST http://192.168.1.20:8080/` with header `Authorization: Bearer tk_secret`

#### Scenario: No Authorization header without a token
- **WHEN** an ntfy token without `authToken` is delivered to
- **THEN** the request SHALL NOT carry an `Authorization` header

#### Scenario: Auth failure and rate limit keep the token
- **WHEN** the ntfy server answers `403`, `404` or `429`
- **THEN** the result SHALL be `{ok: false}`, the token SHALL be kept, `consecutiveFailures` SHALL increase by one, and no retry SHALL be made

#### Scenario: Redirect not followed
- **WHEN** the ntfy server answers `302` with a `Location` header
- **THEN** no request SHALL be made to the `Location` target and the result SHALL be `{ok: false}`

#### Scenario: Blocked address refused at delivery
- **WHEN** an ntfy token's host resolves at delivery time to `169.254.169.254`
- **THEN** no connection SHALL be made and the result SHALL be `{ok: false}`

#### Scenario: Secrets never echoed
- **WHEN** an ntfy token `https://ntfy.sh/pi-Xk3abcdefghijklmnopqrstuv` with label `Robert's phone` and `authToken` `tk_secret` is listed, tested or logged
- **THEN** it SHALL appear as `Robert's phone (https://ntfy.sh/pi-X…)`
- **AND** the strings `Xk3abcdefghijklmnopqrstuv` and `tk_secret` SHALL NOT appear in any response or log line

### Requirement: Live push toggle
`push.enabled` SHALL take effect without a restart. A `PUT /api/config` whose body contains a `push` key SHALL reload the running push configuration. The dispatcher SHALL be constructed at boot regardless of `enabled`, SHALL do no I/O and create no file on construction, and `fanout`, every `/api/push/*` handler and VAPID initialisation SHALL read `enabled` from the live configuration on each call. Disabling SHALL keep registered tokens.

#### Scenario: Enable without restart
- **WHEN** the server booted with push disabled and a client sends `PUT /api/config` with `{push: {enabled: true}}`
- **THEN** `GET /api/push/register` SHALL answer `200` without a restart
- **AND** the next qualifying trigger SHALL be delivered to registered tokens

#### Scenario: Disable without restart
- **WHEN** push is enabled with one registered token and a client sends `PUT /api/config` with `{push: {enabled: false}}`
- **THEN** every `/api/push/*` route SHALL answer `404` to an authenticated caller
- **AND** the next qualifying trigger SHALL cause no outbound call
- **AND** after re-enabling, the same token SHALL be listed with its original `tokenId`

#### Scenario: Enabling alone creates no VAPID file
- **WHEN** push is enabled live and no client has requested the VAPID key
- **THEN** `~/.pi/dashboard/push-vapid.json` SHALL NOT exist

## MODIFIED Requirements

### Requirement: Push trigger gating and cadence
The server SHALL consider a push only on a qualifying trigger as defined by the `event-wiring` capability: `isUnreadTrigger` true, no browser viewing the session, not a replay. The three triggers are turn finished, waiting on `ask_user`, and crash. Device tokens (`web-push`, `fcm`, `ntfy`) SHALL be delivered only when the call carries `unreadEdge: true`, and are not coalesced. Webhook tokens SHALL be delivered on every qualifying trigger, subject to coalescing.

#### Scenario: Agent finishes a turn → push fired
- **WHEN** a read session transitions `streaming → idle` with no viewer, outside replay
- **THEN** each registered token SHALL receive one push for that session

#### Scenario: Agent waits for user input → push fired
- **WHEN** `currentTool` becomes `"ask_user"` on a read session under the same gating, via either the `event_forward` or the `prompt_request` path
- **THEN** each registered token SHALL receive exactly one push, classified as "waiting for input"

#### Scenario: Agent crashes → push fired
- **WHEN** `agent_end` arrives with a truthy error on a read session under the same gating
- **THEN** each registered token SHALL receive one push whose body contains the truncated error

#### Scenario: Browser is viewing the session → no push
- **WHEN** a trigger fires while `viewedSessionTracker.isViewedByAnyone(sessionId)` is true
- **THEN** no token SHALL receive a push

#### Scenario: Replay event → no push
- **WHEN** a replay-flagged event matches a trigger
- **THEN** no token SHALL receive a push

#### Scenario: Unread session does not re-buzz a device
- **WHEN** a session already pushed stays unread and finishes another turn after the coalescing window
- **THEN** device tokens SHALL NOT receive a push until the session is viewed, which clears `unread`

#### Scenario: Unread session does not re-buzz an ntfy phone
- **WHEN** a session already pushed to an ntfy token stays unread and finishes another turn after the coalescing window
- **THEN** the ntfy token SHALL NOT receive a push until the session is viewed

#### Scenario: Unread session still reaches a webhook
- **WHEN** a session stays unread and finishes another turn after the coalescing window
- **THEN** webhook tokens SHALL receive a push

### Requirement: Push payload
`buildPushPayload` SHALL produce `{type: "session_attention", trigger, sessionId, title, body, url, absoluteUrl?}`:
- `trigger` ∈ {`turn_end`, `input`, `crash`}.
- `url` is `/session/<sessionId>`.
- `absoluteUrl` is `<base>/session/<encodeURIComponent(sessionId)>`, with trailing slashes stripped from `<base>`. `<base>` is the first `resolvePublicBaseUrls(config)` entry, else the live tunnel URL. When neither exists, `absoluteUrl` SHALL be absent.
- `title` is `"<name>: turn finished"`, `"<name>: waiting for input"` or `"<name>: crashed"`, where `<name>` is the session name, or the basename of the session's cwd when the name is empty.
- `body` is the session's model id (empty string if unknown). For `crash`, it is the error message: kept verbatim up to 200 characters, and cut to its first 200 characters plus `…` when longer.

No other event content SHALL be included.

#### Scenario: Waiting-for-input title with a session name
- **WHEN** session `abc-123` named `fix-login` on model `claude-opus-5` hits the `ask_user` trigger and no base URL exists
- **THEN** the payload SHALL be `{type: "session_attention", trigger: "input", sessionId: "abc-123", title: "fix-login: waiting for input", body: "claude-opus-5", url: "/session/abc-123"}`

#### Scenario: Name falls back to cwd basename
- **WHEN** a session with an empty name and cwd `/home/u/proj/api` finishes a turn
- **THEN** the title SHALL be `"api: turn finished"`

#### Scenario: Crash error at the truncation boundary
- **WHEN** the crash error message is 200 characters long
- **THEN** `body` SHALL equal the message unchanged
- **AND WHEN** it is 201 characters long
- **THEN** `body` SHALL be its first 200 characters followed by `…`

#### Scenario: absoluteUrl from publicBaseUrls
- **WHEN** `publicBaseUrls` is `["https://pi.example.com/"]` and a tunnel is also active
- **THEN** `absoluteUrl` SHALL be `https://pi.example.com/session/<sessionId>`

#### Scenario: absoluteUrl from the tunnel
- **WHEN** no public base URL is configured and the tunnel URL is `https://abc.share.zrok.io`
- **THEN** `absoluteUrl` SHALL be `https://abc.share.zrok.io/session/<sessionId>`

### Requirement: Registration validation and capacity
`POST /api/push/register` SHALL answer `400` unless all of these hold:
- `transport` ∈ {`web-push`, `fcm`, `webhook`, `ntfy`};
- for `web-push`, `deviceToken` is the JSON of a `PushSubscription` with an `https:` `endpoint` and non-empty `keys.p256dh` and `keys.auth`;
- for `fcm`, `deviceToken` is a non-empty string;
- for `webhook`, the Webhook transport rules hold;
- for `ntfy`, `deviceToken` parses with `new URL()` to scheme `http:` or `https:`, no userinfo, no query, no fragment, and a pathname of exactly `/<topic>` with `<topic>` matching `^[-_A-Za-z0-9]{1,64}$`; and the host passes the webhook address policy;
- `authToken`, if present, is only sent with `transport: "ntfy"` and is 1–256 printable ASCII characters;
- `label`, if present, is ≤ 64 characters;
- `sessionFilter`, if present, is an array of ≤ 100 non-empty strings.

The registry SHALL hold at most 50 tokens. Registering a 51st distinct `deviceToken` SHALL answer `409`; re-registering an existing `deviceToken` SHALL succeed at capacity and SHALL replace its `authToken` and `label` while keeping its `tokenId`. A web-push token SHALL be displayed as `"<endpoint host> browser"`, an fcm token as `"fcm device"`, and an ntfy token as `"<origin>/<first 4 topic chars>…"`, prefixed by `"<label> ("` and suffixed by `")"` when a label is set. The web-push endpoint path, the full ntfy topic and any `authToken` SHALL never appear in a response or a log line.

#### Scenario: Malformed web-push subscription rejected
- **WHEN** a client registers `web-push` with an `http:` endpoint, or with `keys.auth` missing
- **THEN** the response SHALL be `400`

#### Scenario: Malformed ntfy topic URL rejected
- **WHEN** a client registers `ntfy` with `https://ntfy.sh/a/b`, `https://ntfy.sh/`, `https://ntfy.sh/bad.topic`, a 65-character topic, `https://u:p@ntfy.sh/t`, `https://ntfy.sh/t?auth=x` or `ftp://ntfy.sh/t`
- **THEN** the response SHALL be `400` and no token SHALL be stored

#### Scenario: ntfy topic length boundary
- **WHEN** the topic is 64 characters of `[-_A-Za-z0-9]`
- **THEN** registration SHALL succeed

#### Scenario: authToken only for ntfy
- **WHEN** a client registers `webhook` with an `authToken`, or `ntfy` with an empty or 257-character `authToken`
- **THEN** the response SHALL be `400`

#### Scenario: Re-registering an ntfy topic rotates its token
- **WHEN** an ntfy topic URL is registered with `authToken` `tk_a` and then again with `tk_b`
- **THEN** both responses SHALL carry the same `tokenId` and the next delivery SHALL use `Bearer tk_b`

#### Scenario: Capacity boundary
- **WHEN** 50 tokens are registered and a client registers a 51st distinct `deviceToken`
- **THEN** the response SHALL be `409`
- **AND WHEN** the client re-registers one of the existing 50
- **THEN** the response SHALL be `200` with that token's original `tokenId`

#### Scenario: sessionFilter bounds
- **WHEN** `sessionFilter` has 100 non-empty strings
- **THEN** registration SHALL succeed
- **AND WHEN** it has 101 entries, an empty string, or is not an array
- **THEN** the response SHALL be `400`

#### Scenario: Label bound
- **WHEN** `label` is 64 characters
- **THEN** registration SHALL succeed
- **AND WHEN** it is 65 characters
- **THEN** the response SHALL be `400`

#### Scenario: Web Push endpoint not echoed
- **WHEN** a web-push token with endpoint `https://fcm.googleapis.com/fcm/send/SECRETID` is listed or logged
- **THEN** it SHALL appear as `fcm.googleapis.com browser`, and `SECRETID` SHALL NOT appear

### Requirement: Three transports behind one interface
The dispatcher SHALL support Web Push (W3C, VAPID-authenticated), Firebase Cloud Messaging (HTTP v1 API), a generic webhook and ntfy, each implementing `PushTransport`. A further transport SHALL require only a new file in `push-transports/` plus a registry entry, with no change to the trigger logic, the registry or the call site.

#### Scenario: Web Push transport sends a notification
- **WHEN** a `web-push` token is dispatched to and the push service answers `201`
- **THEN** the result SHALL be `{ok: true}`

#### Scenario: FCM transport sends a notification
- **WHEN** an `fcm` token is dispatched to
- **THEN** the request SHALL carry a Bearer token from a JWT signed with the configured service-account key

#### Scenario: ntfy transport sends a notification
- **WHEN** an `ntfy` token is dispatched to and the ntfy server answers `200`
- **THEN** the result SHALL be `{ok: true}`

#### Scenario: Unknown transport
- **WHEN** a persisted token has an unrecognised `transport`
- **THEN** it SHALL be skipped with a warning and dispatch to other tokens SHALL continue

### Requirement: Push REST API
The server SHALL always register these routes and route them through the existing auth chain, which runs before the disabled check. Tiers in `ROUTE_TIERS`: `GET /api/push/vapid-public-key` is `observe`; `GET /api/push/register`, `POST /api/push/register`, `DELETE /api/push/register/:tokenId` and `POST /api/push/test` are `operate`. None SHALL be exposed as MCP tools.
- `POST /api/push/register`, body `{deviceToken, transport, label?, authToken?, sessionFilter?}` → `200 {tokenId}`, or `400` on invalid input.
- `GET /api/push/register` → `200 {tokens: [{tokenId, transport, display, registeredAt, lastUsedAt, consecutiveFailures}]}`.
- `DELETE /api/push/register/:tokenId` → `204`.
- `POST /api/push/test`, body `{tokenId?}` → `200 {results: [{tokenId, ok, gone?}]}`, carrying no HTTP status, error text or timing. Test deliveries SHALL bypass coalescing and the cadence rule.
- `GET /api/push/vapid-public-key` → `200 {publicKey}`.

#### Scenario: Unauthenticated register is rejected
- **WHEN** `POST /api/push/register` arrives without valid credentials from a non-loopback, untrusted host
- **THEN** the response SHALL be `401`

#### Scenario: Test endpoint with no tokens
- **WHEN** no tokens are registered and a client POSTs `/api/push/test` with no body
- **THEN** the response SHALL be `200 {results: []}`

#### Scenario: Test result is opaque
- **WHEN** a test delivery to a webhook or ntfy token fails with `500` or a timeout
- **THEN** its result entry SHALL be exactly `{tokenId, ok: false}`

#### Scenario: Auth precedes the disabled check
- **WHEN** push is disabled and an unauthenticated, non-loopback, untrusted caller hits any `/api/push/*` route
- **THEN** the response SHALL be `401`, not `404`

#### Scenario: Route tiers are complete
- **WHEN** the route-tier and MCP-manifest completeness tests run
- **THEN** every `/api/push/*` route SHALL have a `ROUTE_TIERS` entry and a `DENYLIST` entry

### Requirement: Opt-in by default
A config without a `push` block, or with `enabled` not strictly `true`, SHALL be treated as disabled. While disabled, as read from the live configuration on each call, the server SHALL NOT generate VAPID keys and SHALL NOT make any push-related outbound call, and every `/api/push/*` route SHALL answer `404`. These rules SHALL hold both when push was disabled at boot and after a live disable.

#### Scenario: Default config has push disabled
- **WHEN** a config with no `push` block is loaded
- **THEN** the parsed `push.enabled` SHALL be `false` and no push side effect SHALL occur on event flow

#### Scenario: Disabled server returns 404
- **WHEN** push is disabled and a client GETs `/api/push/vapid-public-key`
- **THEN** the response SHALL be `404`

#### Scenario: Live-disabled server makes no outbound call
- **WHEN** push was enabled, is disabled via `PUT /api/config`, and a qualifying trigger fires with tokens registered
- **THEN** no transport SHALL make an outbound call

### Requirement: Push Settings UI
`PushNotificationsSection` in `packages/client/src/components/settings/`, mounted in `SettingsPanel.tsx`, SHALL show:
- a server-wide **Enable push notifications** switch that sends `PUT /api/config` with `{push: {enabled}}`, shown whether push is enabled or not, restoring its previous state and showing an inline error when the request fails;
- while enabled: a toggle to subscribe or unsubscribe this browser (Web Push); the registered tokens, by `display` only, each with unregister and Send Test actions and its `consecutiveFailures` when non-zero; an "Add webhook URL" form (URL plus optional label); and an **Add phone (ntfy)** action;
- the tap target: `Taps open <base>` when a base URL exists, otherwise a notice that taps will not open the dashboard.

Adding a webhook or an ntfy phone SHALL NOT require Web Push support. All controls SHALL be keyboard-operable and labelled.

#### Scenario: Settings adds a webhook
- **WHEN** the user enters a valid URL and label and submits
- **THEN** the client SHALL POST `/api/push/register` with `{transport: "webhook", deviceToken, label}`
- **AND** the list SHALL show the new entry as `label (origin)`

#### Scenario: Server rejects the URL
- **WHEN** the register call answers `400`
- **THEN** the error SHALL be shown inline and linked to the input via `aria-describedby`

#### Scenario: Insecure context
- **WHEN** the dashboard is opened over plain `http://` on a non-localhost host
- **THEN** the section SHALL say Web Push needs https or localhost, SHALL hide the browser toggle, and SHALL still offer "Add webhook URL" and "Add phone (ntfy)"

#### Scenario: Push disabled on server
- **WHEN** `/api/push/*` answers `404`
- **THEN** the section SHALL show the **Enable push notifications** switch in the off state and no other push controls

#### Scenario: Enable from Settings
- **WHEN** the user turns the switch on
- **THEN** the client SHALL send `PUT /api/config` with `{push: {enabled: true}}` and, on success, SHALL load the token list and show the push controls without a page reload

#### Scenario: Enable fails
- **WHEN** the `PUT /api/config` request fails
- **THEN** the switch SHALL return to off and an inline error SHALL be shown

#### Scenario: Add an Android phone
- **WHEN** the user opens **Add phone (ntfy)** with the default server `https://ntfy.sh`
- **THEN** the dialog SHALL generate a topic matching `^pi-[-_A-Za-z0-9]{24}$` using `crypto.getRandomValues`
- **AND** SHALL show a QR code encoding `ntfy://ntfy.sh/<topic>?display=Pi%20Dashboard`

#### Scenario: http ntfy server deep link
- **WHEN** the server URL is `http://192.168.1.20:8080`
- **THEN** the QR code SHALL encode `ntfy://192.168.1.20:8080/<topic>?display=Pi%20Dashboard&secure=false`

#### Scenario: Add an iPhone
- **WHEN** the Add phone dialog is open
- **THEN** it SHALL show copy buttons for the server URL and the topic, and iOS steps for adding the subscription in the ntfy app
- **AND WHEN** the server URL is not `https://ntfy.sh`
- **THEN** it SHALL show that the ntfy server needs `upstream-base-url: "https://ntfy.sh"` for instant iOS delivery

#### Scenario: Register and test the phone
- **WHEN** the user confirms the dialog with label `Robert's phone` and an optional access token
- **THEN** the client SHALL POST `/api/push/register` with `{transport: "ntfy", deviceToken: "<server>/<topic>", label, authToken?}`
- **AND** on `200` SHALL POST `/api/push/test` with the returned `tokenId` and show the ok or failed result inline

#### Scenario: No tap target
- **WHEN** no public base URL is configured and no tunnel is active
- **THEN** the section SHALL state that notification taps will not open the dashboard
