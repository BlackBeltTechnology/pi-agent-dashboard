# push-notifications Specification

## Purpose
TBD - created by archiving change add-server-push-notifications. Update Purpose after archive.

## Requirements

### Requirement: Push trigger gating and cadence
The server SHALL consider a push only on a qualifying trigger as defined by the `event-wiring` capability: `isUnreadTrigger` true, no browser viewing the session, not a replay. The three triggers are turn finished, waiting on `ask_user`, and crash. Device tokens (`web-push`, `fcm`) SHALL be delivered only when the call carries `unreadEdge: true`, and are not coalesced. Webhook tokens SHALL be delivered on every qualifying trigger, subject to coalescing.

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

#### Scenario: Unread session still reaches a webhook
- **WHEN** a session stays unread and finishes another turn after the coalescing window
- **THEN** webhook tokens SHALL receive a push

### Requirement: Push payload
`buildPushPayload` SHALL produce `{type: "session_attention", trigger, sessionId, title, body, url}`:
- `trigger` ∈ {`turn_end`, `input`, `crash`}.
- `url` is `/session/<sessionId>`.
- `title` is `"<name>: turn finished"`, `"<name>: waiting for input"` or `"<name>: crashed"`, where `<name>` is the session name, or the basename of the session's cwd when the name is empty.
- `body` is the session's model id (empty string if unknown). For `crash`, it is the error message: kept verbatim up to 200 characters, and cut to its first 200 characters plus `…` when longer.

No other event content SHALL be included.

#### Scenario: Waiting-for-input title with a session name
- **WHEN** session `abc-123` named `fix-login` on model `claude-opus-5` hits the `ask_user` trigger
- **THEN** the payload SHALL be `{type: "session_attention", trigger: "input", sessionId: "abc-123", title: "fix-login: waiting for input", body: "claude-opus-5", url: "/session/abc-123"}`

#### Scenario: Name falls back to cwd basename
- **WHEN** a session with an empty name and cwd `/home/u/proj/api` finishes a turn
- **THEN** the title SHALL be `"api: turn finished"`

#### Scenario: Crash error at the truncation boundary
- **WHEN** the crash error message is 200 characters long
- **THEN** `body` SHALL equal the message unchanged
- **AND WHEN** it is 201 characters long
- **THEN** `body` SHALL be its first 200 characters followed by `…`

### Requirement: Registration validation and capacity
`POST /api/push/register` SHALL answer `400` unless all of these hold:
- `transport` ∈ {`web-push`, `fcm`, `webhook`};
- for `web-push`, `deviceToken` is the JSON of a `PushSubscription` with an `https:` `endpoint` and non-empty `keys.p256dh` and `keys.auth`;
- for `fcm`, `deviceToken` is a non-empty string;
- for `webhook`, the Webhook transport rules hold;
- `label`, if present, is ≤ 64 characters;
- `sessionFilter`, if present, is an array of ≤ 100 non-empty strings.

The registry SHALL hold at most 50 tokens. Registering a 51st distinct `deviceToken` SHALL answer `409`; re-registering an existing `deviceToken` SHALL succeed at capacity. A web-push token SHALL be displayed as `"<endpoint host> browser"` and an fcm token as `"fcm device"`. The endpoint path SHALL never appear in a response or a log line.

#### Scenario: Malformed web-push subscription rejected
- **WHEN** a client registers `web-push` with an `http:` endpoint, or with `keys.auth` missing
- **THEN** the response SHALL be `400`

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

### Requirement: Fire-and-forget dispatch
`fanout` SHALL return `void`, SHALL NOT throw, and SHALL NOT produce an unhandled promise rejection. It SHALL do no disk or network I/O synchronously: tokens are served from memory and delivery is scheduled asynchronously. The event-wiring call site SHALL NOT `await` or chain on `fanout`.

#### Scenario: Transport hangs indefinitely
- **WHEN** a transport's `send` never resolves
- **THEN** event-forwarding latency to connected browsers SHALL stay within 10 ms of baseline

#### Scenario: Transport throws synchronously
- **WHEN** a transport's `send` throws synchronously
- **THEN** `fanout` SHALL NOT propagate the throw
- **AND** the failure SHALL be logged at `level: "error"` with the `tokenId`

#### Scenario: Transport rejects
- **WHEN** a transport's `send` returns a rejected promise
- **THEN** no `unhandledRejection` SHALL be emitted and the failure SHALL be logged

#### Scenario: No synchronous disk read on dispatch
- **WHEN** `fanout` is called with tokens registered
- **THEN** it SHALL NOT call `fs.readFileSync` or any other synchronous fs read

#### Scenario: Lint enforcement
- **WHEN** the test suite runs
- **THEN** a test SHALL fail if `event-wiring.ts` contains an `await` or a `.then(` applied to a `fanout(` call

### Requirement: Per-(session, token) webhook coalescing
The dispatcher SHALL deliver at most one push per `(sessionId, tokenId)` per `coalesceWindowMs` (default 30 000, clamped 5 000 – 300 000) to **webhook** tokens. Different tokens and different sessions SHALL be coalesced independently. Removing a token SHALL drop its coalescing entries. Device tokens SHALL NOT be coalesced; the unread edge bounds them.

#### Scenario: Rapid triggers within the window
- **WHEN** `fanout` is called five times for one session within 10 s, with one webhook token registered
- **THEN** the token SHALL receive exactly one push

#### Scenario: New device edge inside the window is delivered
- **WHEN** a device token is pushed on an unread edge, the user views the session (clearing `unread`), and a new qualifying trigger arrives 5 s later
- **THEN** the device token SHALL receive a second push

#### Scenario: Two tokens, one trigger
- **WHEN** one trigger fires on a read session with two tokens registered
- **THEN** each token SHALL receive exactly one push

#### Scenario: Two sessions, one token
- **WHEN** triggers fire for read sessions A then B within 10 s, with one webhook token
- **THEN** the token SHALL receive two pushes

#### Scenario: After the window closes
- **WHEN** triggers fire at t=0 and t=31 000 ms with a 30 000 ms window, for one webhook token
- **THEN** the token SHALL receive two pushes

#### Scenario: Re-registration keeps the window
- **WHEN** a webhook token is pushed, the same `deviceToken` is registered again, and a trigger fires within the window
- **THEN** no second push SHALL be sent

### Requirement: Token persistence and lifecycle
The registry SHALL hold tokens in memory and write `add`/`remove` through to `~/.pi/dashboard/push-tokens.json` immediately, atomically (tmp + rename), with file mode `0600`. `lastUsedAt` updates SHALL be persisted at most once per 60 s. Each token SHALL carry `{id, deviceToken, transport, label?, userId?, sessionFilter?, registeredAt, lastUsedAt}`, plus an in-memory `consecutiveFailures` counter that resets on success. `sessionFilter`, when present and non-empty, SHALL restrict delivery to those exact session ids; absent or empty SHALL mean all sessions. Tokens SHALL be pruned when a transport reports them gone.

#### Scenario: Server restart preserves tokens
- **WHEN** a token is registered and the server restarts
- **THEN** the token SHALL be present after restart with the same `id`

#### Scenario: Idempotent registration
- **WHEN** the same `deviceToken` is registered twice
- **THEN** exactly one entry SHALL exist, with the original `id` and the newer `lastUsedAt`

#### Scenario: Registry file is private
- **WHEN** the registry file is written
- **THEN** it SHALL have mode `0600`, even when a stale `.tmp` file with mode `0644` existed beforehand

#### Scenario: Dead-token pruning
- **WHEN** a transport returns `{ok: false, gone: true}`
- **THEN** the token SHALL be removed from memory and the file

#### Scenario: Corrupt registry file at startup
- **WHEN** `push-tokens.json` contains invalid JSON and the server starts with push enabled
- **THEN** the file SHALL be renamed to `push-tokens.json.corrupt-<epoch ms>`, the registry SHALL start empty, the server SHALL start normally, and `push.errors` SHALL contain an entry for the corrupt registry

#### Scenario: Session filter limits delivery
- **WHEN** a token has `sessionFilter: ["A"]` and a trigger fires for session B
- **THEN** that token SHALL NOT receive a push

### Requirement: Three transports behind one interface
The dispatcher SHALL support Web Push (W3C, VAPID-authenticated), Firebase Cloud Messaging (HTTP v1 API) and a generic webhook, each implementing `PushTransport`. A fourth transport SHALL require only a new file in `push-transports/` plus a registry entry, with no change to the trigger logic, the registry or the call site.

#### Scenario: Web Push transport sends a notification
- **WHEN** a `web-push` token is dispatched to and the push service answers `201`
- **THEN** the result SHALL be `{ok: true}`

#### Scenario: FCM transport sends a notification
- **WHEN** an `fcm` token is dispatched to
- **THEN** the request SHALL carry a Bearer token from a JWT signed with the configured service-account key

#### Scenario: Unknown transport
- **WHEN** a persisted token has an unrecognised `transport`
- **THEN** it SHALL be skipped with a warning and dispatch to other tokens SHALL continue

### Requirement: Webhook transport
A `webhook` token SHALL carry an absolute `http:`/`https:` URL as `deviceToken` and an optional `label` of at most 64 characters. On dispatch the server SHALL POST the `PushPayload` as `application/json`. It SHALL NOT follow redirects, SHALL abort after 5 000 ms, and SHALL discard the response body. It SHALL refuse link-local and metadata destinations (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, and their IPv4-mapped forms), checked on the parsed hostname and on every resolved address at registration and at every delivery. If any address is blocked, the request SHALL be refused, and the connection SHALL be pinned to the checked addresses. Loopback and private-LAN destinations SHALL be allowed, except the dashboard's own listen port on a loopback or local-interface address, which SHALL be refused. Outcomes: `2xx` → `{ok: true}`; `410` → `{ok: false, gone: true}`; anything else, including `404`, → `{ok: false}`, with no retry and `consecutiveFailures` incremented. In every API response and log line the server SHALL render a webhook token only as its label plus origin, and SHALL NOT log raw error objects from the webhook transport.

#### Scenario: Webhook receives the payload
- **WHEN** a trigger fires for session `abc-123` with one webhook token at `http://127.0.0.1:8787/api/hooks/h1?key=k`
- **THEN** the receiver SHALL get exactly one `POST` with `Content-Type: application/json` and body `{type, sessionId: "abc-123", title, body, url}`

#### Scenario: Invalid URL rejected at registration
- **WHEN** a client registers a webhook whose `deviceToken` is `file:///etc/passwd`, an `ftp:`/`javascript:` URL, a relative path, or a URL with `user:pass@` userinfo
- **THEN** the response SHALL be `400` and no token SHALL be stored

#### Scenario: Metadata address refused at registration
- **WHEN** a client registers `http://169.254.169.254/latest/meta-data`, its numeric form `http://2852039166/`, `http://[::ffff:169.254.169.254]/`, or a hostname with any A/AAAA record in a blocked range
- **THEN** the response SHALL be `400` and no token SHALL be stored

#### Scenario: Rebinding to a metadata address refused at delivery
- **WHEN** a registered webhook hostname resolves to a link-local address at delivery time
- **THEN** no connection SHALL be made, and the delivery SHALL be `{ok: false}` with the token kept

#### Scenario: Self-target refused
- **WHEN** a client registers `http://127.0.0.1:<dashboard port>/api/restart`
- **THEN** the response SHALL be `400` and no token SHALL be stored

#### Scenario: LAN receiver allowed
- **WHEN** a client registers `http://192.168.1.20:8787/api/hooks/h1?key=k`
- **THEN** the token SHALL be stored and receive deliveries

#### Scenario: Redirect is not followed
- **WHEN** the webhook answers `302` with a `Location` header
- **THEN** no request SHALL be made to the `Location` target, and the delivery SHALL be `{ok: false}` with the token kept

#### Scenario: Gone receiver is pruned
- **WHEN** the webhook answers `410`
- **THEN** the token SHALL be removed

#### Scenario: 404 receiver is kept and flagged
- **WHEN** the webhook answers `404` three times in a row
- **THEN** the token SHALL be kept and `GET /api/push/register` SHALL report `consecutiveFailures: 3` for it

#### Scenario: Rate-limited receiver is kept
- **WHEN** the webhook answers `429`
- **THEN** the delivery SHALL be `{ok: false}`, logged, not retried, and the token kept

#### Scenario: Hanging receiver does not block
- **WHEN** the webhook never responds
- **THEN** the request SHALL abort at 5 000 ms and be logged as a failure

#### Scenario: Secret never echoed
- **WHEN** a webhook token at `https://hooks.example:8443/api/hooks/h1?key=s3cret` with label `nanoMuse` appears in an API response or a log line, including a transport-error log line
- **THEN** it SHALL appear as `nanoMuse (https://hooks.example:8443)`, and neither `/api/hooks/h1` nor `s3cret` SHALL appear

### Requirement: VAPID key lifecycle
The server SHALL generate a VAPID keypair on the first start with push enabled, persist it at `~/.pi/dashboard/push-vapid.json` with mode `0600`, and reuse it across restarts.

#### Scenario: Keypair generated once
- **WHEN** the server first starts with `push.enabled: true`
- **THEN** `push-vapid.json` SHALL be created with `{publicKey, privateKey}` and mode `0600`

#### Scenario: Keypair reused
- **WHEN** the server restarts with the file present
- **THEN** the existing keypair SHALL be loaded, not regenerated

#### Scenario: Public key endpoint
- **WHEN** an authenticated client GETs `/api/push/vapid-public-key`
- **THEN** the response SHALL be `200 {publicKey: <base64url>}`

### Requirement: Push REST API
The server SHALL always register these routes and route them through the existing auth chain, which runs before the disabled check. Tiers in `ROUTE_TIERS`: `GET /api/push/vapid-public-key` is `observe`; `GET /api/push/register`, `POST /api/push/register`, `DELETE /api/push/register/:tokenId` and `POST /api/push/test` are `operate`. None SHALL be exposed as MCP tools.
- `POST /api/push/register`, body `{deviceToken, transport, label?, sessionFilter?}` → `200 {tokenId}`, or `400` on invalid input.
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
- **WHEN** a test delivery to a webhook fails with `500` or a timeout
- **THEN** its result entry SHALL be exactly `{tokenId, ok: false}`

#### Scenario: Auth precedes the disabled check
- **WHEN** push is disabled and an unauthenticated, non-loopback, untrusted caller hits any `/api/push/*` route
- **THEN** the response SHALL be `401`, not `404`

#### Scenario: Route tiers are complete
- **WHEN** the route-tier and MCP-manifest completeness tests run
- **THEN** every `/api/push/*` route SHALL have a `ROUTE_TIERS` entry and a `DENYLIST` entry

### Requirement: Opt-in by default
A config without a `push` block, or with `enabled` not strictly `true`, SHALL be treated as disabled. While disabled the server SHALL NOT construct the dispatcher, SHALL NOT generate VAPID keys and SHALL NOT make any push-related outbound call, and every `/api/push/*` route SHALL answer `404`.

#### Scenario: Default config has push disabled
- **WHEN** a config with no `push` block is loaded
- **THEN** the parsed `push.enabled` SHALL be `false` and no push side effect SHALL occur on event flow

#### Scenario: Disabled server returns 404
- **WHEN** push is disabled and a client GETs `/api/push/vapid-public-key`
- **THEN** the response SHALL be `404`

### Requirement: Service worker push handler
The repo-root `public/sw.js` SHALL handle `push` by calling `self.registration.showNotification(title, {body, data: {url, sessionId}})`. It SHALL handle `notificationclick` by focusing an existing dashboard window and navigating it to `data.url`, or opening a new window at `data.url` when none exists.

#### Scenario: Push event with valid JSON
- **WHEN** the service worker receives a push with body `{title, body, url, sessionId}`
- **THEN** a system notification SHALL be shown with that title and body

#### Scenario: Notification click focuses an open dashboard
- **WHEN** the user taps the notification while a dashboard window is open
- **THEN** that window SHALL be focused and navigated to `data.url`, and no new window SHALL be opened

#### Scenario: Notification click with no open dashboard
- **WHEN** the user taps the notification and no dashboard window exists
- **THEN** a new window SHALL open at `data.url`

### Requirement: Push Settings UI
`PushNotificationsSection` in `packages/client/src/components/settings/`, mounted in `SettingsPanel.tsx`, SHALL show:
- whether push is available;
- a toggle to subscribe or unsubscribe this device;
- the registered tokens, by `display` only, each with unregister and Send Test actions;
- an "Add webhook URL" form (URL plus optional label).

Adding a webhook SHALL NOT require Web Push support.

#### Scenario: Settings adds a webhook
- **WHEN** the user enters a valid URL and label and submits
- **THEN** the client SHALL POST `/api/push/register` with `{transport: "webhook", deviceToken, label}`
- **AND** the list SHALL show the new entry as `label (origin)`

#### Scenario: Server rejects the URL
- **WHEN** the register call answers `400`
- **THEN** the error SHALL be shown inline and linked to the input via `aria-describedby`

#### Scenario: Insecure context
- **WHEN** the dashboard is opened over plain `http://` on a non-localhost host
- **THEN** the section SHALL say Web Push needs https or localhost, SHALL hide the device toggle, and SHALL still offer "Add webhook URL"

#### Scenario: Push disabled on server
- **WHEN** `/api/push/*` answers `404`
- **THEN** the section SHALL show "Push not enabled on this server" and no controls

### Requirement: Push health reporting
Push configuration and transport-initialisation failures SHALL be exposed as `push.errors` in the `/api/health` payload only when `canDiscloseAccessPosture(request)` holds.

#### Scenario: Errors hidden from undisclosed callers
- **WHEN** Web Push is disabled for lack of `contactEmail` and a caller that fails `canDiscloseAccessPosture` GETs `/api/health`
- **THEN** the payload SHALL NOT contain `push.errors`

#### Scenario: Errors shown to disclosed callers
- **WHEN** the same condition holds and a loopback caller GETs `/api/health`
- **THEN** `push.errors` SHALL contain an entry naming the missing `contactEmail`

### Requirement: Capacitor-readiness contract
The REST API and persistence shape SHALL let a future Capacitor shell register FCM tokens with `POST /api/push/register` and `transport: "fcm"`, with no server change.

#### Scenario: FCM token registers and survives a restart
- **GIVEN** `push.enabled: true` and `push.fcm.serviceAccountPath` configured
- **WHEN** a client registers `{deviceToken: "<fcm-token>", transport: "fcm"}`, the server restarts, and a session push triggers
- **THEN** the FCM transport SHALL be invoked with the persisted token and a freshly signed JWT
