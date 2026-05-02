## ADDED Requirements

### Requirement: Push trigger predicate
The dashboard server SHALL fan out push notifications to registered devices using the same trigger predicate (`isUnreadTrigger`) and the same gating (`!viewedSessionTracker.isViewedByAnyone(sessionId)` AND not in replay) that the unread-stripes feature uses. The two consumers MUST share the call site in `event-wiring.ts` so that "what counts as a notable event" has exactly one definition in the codebase.

#### Scenario: Agent finishes a turn → push fired
- **WHEN** a session transitions from `streaming` to `idle` AND no browser is viewing the session AND the event is not part of a replay
- **THEN** the push dispatcher's `fanout(sessionId, event)` SHALL be called exactly once

#### Scenario: Agent waits for user input → push fired
- **WHEN** an event sets `currentTool` to `"ask_user"` under the same gating
- **THEN** `fanout(sessionId, event)` SHALL be called exactly once

#### Scenario: Agent crashes → push fired
- **WHEN** an `agent_end` event arrives with a truthy `payload.error` field under the same gating
- **THEN** `fanout(sessionId, event)` SHALL be called exactly once

#### Scenario: Browser is viewing the session → no push
- **WHEN** any of the three trigger predicates fire AND `viewedSessionTracker.isViewedByAnyone(sessionId) === true`
- **THEN** `fanout` SHALL NOT be called
- **BECAUSE** the user is already looking at the session — push would be redundant noise

#### Scenario: Replay event → no push
- **WHEN** a replay-flagged event matches a trigger predicate
- **THEN** `fanout` SHALL NOT be called
- **BECAUSE** replay re-emits historical events; pushing on cold-start replay would notify the user about events they already saw

### Requirement: Fire-and-forget dispatch
The push dispatcher's `fanout` method SHALL be `void`-returning at the type level and SHALL NOT throw under any input. The call site in `event-wiring.ts` MUST NOT `await` the dispatcher. Transport latency or failure MUST NOT delay or block the WebSocket fan-out to connected browsers.

#### Scenario: Transport hangs indefinitely
- **WHEN** an FCM POST never resolves (simulated by holding the response open for 60 s)
- **THEN** the event-forwarding latency to connected browsers SHALL be unaffected (within 10 ms of baseline)

#### Scenario: Transport throws synchronously
- **WHEN** a transport's `send` throws synchronously (e.g. malformed payload)
- **THEN** `fanout` SHALL NOT propagate the throw
- **AND** the failure SHALL be logged to the structured logger with `level: "error"` and the offending tokenId

#### Scenario: Lint enforcement
- **WHEN** the test suite runs
- **THEN** a lint test SHALL fail the build if `event-wiring.ts` contains `await pushDispatcher.fanout` or `await deps.pushDispatcher.fanout`

### Requirement: Per-(session, device) coalescing
The dispatcher SHALL coalesce push notifications to at most one delivery per (sessionId, deviceToken) per `coalesceWindowMs` (default 30 000 ms, configurable in the range 5 000 – 300 000 ms). Different devices for the same session SHALL each receive their own push within the window. Different sessions SHALL each get their own push within the window.

#### Scenario: Five rapid triggers within 10 s
- **WHEN** five trigger events fire for the same session within 10 s, with one device registered
- **THEN** the device SHALL receive exactly one push

#### Scenario: Two devices, one trigger
- **WHEN** one trigger event fires for a session, with two devices registered
- **THEN** each device SHALL receive exactly one push

#### Scenario: Two sessions, one device
- **WHEN** trigger events fire for session A then session B within 10 s, with one device registered
- **THEN** the device SHALL receive two pushes (one per session)

#### Scenario: After the window closes
- **WHEN** a trigger fires at t=0 and another at t=31 000 ms (window=30 000), one device
- **THEN** the device SHALL receive two pushes

### Requirement: Token persistence and lifecycle
The server SHALL persist registered push tokens to `~/.pi/dashboard/push-tokens.json` via atomic writes (tmp+rename). Each token SHALL carry `{id, deviceToken, transport, userId?, sessionFilter?, registeredAt, lastUsedAt}`. Tokens SHALL be pruned automatically when a transport reports the token as gone (Web Push `410`, FCM `NOT_FOUND` / `UNREGISTERED`).

#### Scenario: Server restart preserves tokens
- **WHEN** a token is registered, the server is restarted
- **THEN** the token SHALL still be present in the registry after restart

#### Scenario: Idempotent registration
- **WHEN** the same `deviceToken` is registered twice
- **THEN** the registry SHALL contain exactly one entry for that deviceToken
- **AND** `lastUsedAt` SHALL reflect the more recent registration

#### Scenario: Dead-token pruning
- **WHEN** a transport returns `{ok: false, gone: true}` for a token during dispatch
- **THEN** the token SHALL be removed from the registry within the same dispatch call
- **AND** the persistence file SHALL be updated atomically

### Requirement: Two transports behind one interface
The dispatcher SHALL support at minimum two transports — Web Push (W3C, VAPID-authenticated) and Firebase Cloud Messaging (HTTP v1 API) — both implementing a shared `PushTransport` interface. Adding a third transport (e.g. APNs-direct) SHALL require only a new file in `push-transports/` plus an entry in the dispatcher's transport registry; no changes to the trigger logic, the registry, or the call site.

#### Scenario: Web Push transport sends a notification
- **WHEN** a token with `transport: "web-push"` is dispatched to
- **THEN** the Web Push transport's `send` SHALL be invoked with the token and payload
- **AND** a successful 201 response SHALL be reported as `{ok: true}`

#### Scenario: FCM transport sends a notification
- **WHEN** a token with `transport: "fcm"` is dispatched to
- **THEN** the FCM transport's `send` SHALL be invoked with a JWT bearer derived from the configured service-account JSON

#### Scenario: Unknown transport
- **WHEN** a token has an unrecognized `transport` value (e.g. data corruption)
- **THEN** the token SHALL be skipped with a logged warning, without crashing the dispatch

### Requirement: VAPID key lifecycle
The server SHALL generate a VAPID keypair on first start and persist it at `~/.pi/dashboard/push-vapid.json`. The keypair SHALL be reused across restarts so existing browser subscriptions remain valid. The public key SHALL be exposed via `GET /api/push/vapid-public-key` for clients to use during `pushManager.subscribe`.

#### Scenario: Keypair generated once
- **WHEN** the server is started for the first time with `push.enabled: true`
- **THEN** `~/.pi/dashboard/push-vapid.json` SHALL be created with `{publicKey, privateKey}`

#### Scenario: Keypair reused
- **WHEN** the server restarts with the file present
- **THEN** the existing keypair SHALL be loaded; no new keypair SHALL be generated

#### Scenario: Public key endpoint
- **WHEN** an authenticated client GETs `/api/push/vapid-public-key`
- **THEN** the response SHALL be `200 {publicKey: <base64url>}`

### Requirement: Push REST API
The server SHALL expose four auth-gated REST endpoints for device management:
- `POST /api/push/register` — body `{deviceToken, transport, sessionFilter?}` → `200 {tokenId}`.
- `DELETE /api/push/register/:tokenId` → `204`.
- `POST /api/push/test` — body `{tokenId?}` → `200 {results: [{tokenId, ok, gone?}]}`.
- `GET /api/push/vapid-public-key` → `200 {publicKey}`.

All endpoints SHALL participate in the existing auth-plugin chain (loopback, trusted networks, OAuth user, secret token) — no separate auth scheme.

#### Scenario: Unauthenticated register is rejected
- **WHEN** a request to `POST /api/push/register` arrives without a valid auth header from a non-loopback, non-trusted host
- **THEN** the response SHALL be `401`

#### Scenario: Test endpoint with no tokens
- **WHEN** the caller has no registered tokens and POSTs to `/api/push/test` with no body
- **THEN** the response SHALL be `200 {results: []}` (no error, no push)

### Requirement: Opt-in by default
The `push` config block SHALL default to `{enabled: false}`. When `push.enabled !== true`, the server SHALL NOT construct the dispatcher, SHALL NOT mount the push routes, and SHALL NOT generate VAPID keys. Clients calling `/api/push/*` against a disabled server SHALL receive `404`.

#### Scenario: Default config has push disabled
- **WHEN** a fresh `~/.pi/dashboard/config.json` is loaded with no `push` block
- **THEN** `config.push.enabled` SHALL be `false`
- **AND** no push side-effects SHALL occur on event flow

#### Scenario: Disabled server returns 404
- **WHEN** push is disabled and a client GETs `/api/push/vapid-public-key`
- **THEN** the response SHALL be `404`

### Requirement: Service worker push handler
The web client's service worker (`public/sw.js`) SHALL listen for `'push'` events and call `self.registration.showNotification(...)` with title and body from the payload. A `'notificationclick'` listener SHALL navigate to `payload.url` (typically `/session/:id`).

#### Scenario: Push event with valid JSON
- **WHEN** the SW receives a push event with body `{title, body, url, sessionId}`
- **THEN** a system notification SHALL be displayed with that title and body

#### Scenario: Notification click
- **WHEN** the user taps a displayed notification
- **THEN** the SW SHALL open or focus a window at `payload.url`

### Requirement: Capacitor-readiness contract
The REST API and persistence shape defined here SHALL be sufficient for a future Capacitor-based mobile shell to register FCM tokens via `POST /api/push/register` with `transport: "fcm"` without any server-side change. This requirement is verified by a contract test that exercises the FCM-token registration path with a synthetic token.

#### Scenario: FCM token registers and survives a restart
- **GIVEN** a server with `push.enabled: true` and `push.fcm.serviceAccountPath` configured
- **WHEN** a client POSTs `/api/push/register` with `{deviceToken: "<fcm-token>", transport: "fcm"}`, the server restarts, and the client triggers a session push
- **THEN** the FCM transport SHALL be invoked with the persisted token and a freshly-signed JWT
