## ADDED Requirements

### Requirement: Push trigger predicate (separate from unread)

The dashboard server SHALL use a dedicated `isPushTrigger` predicate — distinct from `isUnreadTrigger` — that matches only events requiring user attention: `ask_user` (agent needs input) and `agent_end` with truthy `payload.error` (agent crashed). Routine `streaming→idle` transitions SHALL NOT trigger pushes.

The `ask_user` trigger is **transition-based**: it fires when `currentTool` changes to `"ask_user"` from a non-`"ask_user"` value. A repeated question while `currentTool` is already `"ask_user"` SHALL NOT fire an additional push — coalescing already covers the case where the user hasn't responded yet.

**Rationale**: auto-pushing on every turn completion would spam users. There is no "read" concept in the dashboard — unread stripes are ephemeral, while push notifications are disruptive and persist in the OS notification center.

**Gating** (push is suppressed when):
- A browser has viewed the session within the last 60 seconds (`viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})` returns true)
- Event is a replay (historical re-emission)
- Both gates SHALL be evaluated at the same call site in `event-wiring.ts`, co-located with the unread-stripes evaluation

#### Scenario: Agent waits for user input → push fired
- **WHEN** `currentTool` transitions to `"ask_user"` AND no browser has viewed in the last 60s AND event is not a replay
- **THEN** `pushDispatcher.fanout(sessionId, sessionAfter, event)` SHALL be called exactly once

#### Scenario: Agent crashes → push fired
- **WHEN** an `agent_end` event arrives with truthy `payload.error` under the same gating
- **THEN** `fanout(sessionId, sessionAfter, event)` SHALL be called exactly once

#### Scenario: Agent finishes a turn → NO push
- **WHEN** a session transitions from `streaming` to `idle`
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Browser viewed within 60s → push suppressed
- **WHEN** a push trigger fires AND `viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})` returns true
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Browser last viewed >60s ago → push fires
- **WHEN** a push trigger fires AND last view was >60s ago
- **THEN** `fanout` SHALL be called

#### Scenario: Replay event → no push
- **WHEN** a replay-flagged event matches a push trigger
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Non-push-worthy unread trigger → only unread broadcast
- **WHEN** `isUnreadTrigger` matches but `isPushTrigger` does not (e.g. `streaming→idle`)
- **THEN** the unread broadcast SHALL fire normally; `pushDispatcher` SHALL NOT be called

### Requirement: Fire-and-forget dispatch with safety wrapping

The push dispatcher's `fanout` method SHALL be `void`-returning at the type level and SHALL NOT throw under any input. The `fanout` body SHALL be wrapped in `try/catch`. Async work launched internally SHALL have an attached `.catch(log)` — transport rejections and timeouts SHALL resolve to `{tokenId, ok: false}` rather than rejecting. No unhandled promise rejections SHALL escape.

A separate `sendNow(payload, opts?: {tokenIds?: string[]}): Promise<SendResult[]>` method SHALL be provided for REST endpoints. `sendNow` SHALL NOT apply coalescing. When `opts.tokenIds` is provided, SHALL send only to matching tokens; when omitted, SHALL send to all. Timeout SHALL be enforced at dispatcher level via `Promise.race` — if a transport ignores `AbortSignal`, the dispatcher SHALL still settle within 10s.

`SendResult` type: `{tokenId: string, ok: boolean, gone?: boolean}`. Both `/api/push/test` and `/api/push/send` SHALL return this shape.

Per-send HTTP requests SHALL have a 10s timeout via `AbortController`.

#### Scenario: Transport POST hangs
- **WHEN** a Web Push POST does not resolve within 10s
- **THEN** the send SHALL abort; event-forwarding latency unaffected (within 10 ms of baseline)

#### Scenario: Registry read throws synchronously
- **WHEN** `push-token-registry` throws (e.g. corrupted file)
- **THEN** `fanout` SHALL catch the error, log it, and return

#### Scenario: Payload builder throws synchronously
- **WHEN** `buildPushPayload` throws (e.g. missing session data)
- **THEN** `fanout` SHALL catch the error, log it, and return

#### Scenario: Lint enforcement
- **WHEN** the test suite runs
- **THEN** a lint test SHALL fail if `event-wiring.ts` contains `await pushDispatcher.fanout`

### Requirement: Per-(session, device) coalescing

The dispatcher SHALL coalesce to at most one push per (sessionId, deviceToken) per `coalesceWindowMs` (default 30 000 ms, configurable 5 000–300 000 ms). This applies to `fanout` only; `sendNow` bypasses coalescing.

#### Scenario: Five rapid triggers within 10 s
- **WHEN** five push-trigger events fire for the same session within 10 s, one device
- **THEN** one push delivered

#### Scenario: Two devices, one trigger
- **WHEN** one trigger fires, two devices registered
- **THEN** each device receives one push

#### Scenario: Two sessions, one device
- **WHEN** triggers fire for session A then session B within 10 s, one device
- **THEN** two pushes delivered

#### Scenario: After window closes
- **WHEN** trigger at t=0, another at t=31s (window=30s), one device
- **THEN** two pushes delivered

### Requirement: Token persistence and lifecycle

Push tokens SHALL be persisted to `~/.pi/dashboard/push-tokens.json` via atomic writes (tmp+rename) with `0600` permissions. Each token:

```ts
{
  id: string;
  deviceToken: PushSubscriptionJSON; // {endpoint, keys: {p256dh, auth}} — full Web Push subscription
  transport: string;                 // "web-push" for v1
  userId?: string;
  registeredAt: string;
  lastUsedAt: string;
}
```

Uniqueness by `deviceToken.endpoint`. Re-registration SHALL update existing entry.

**Endpoint validation on register**: `endpoint` SHALL be an HTTPS URL. `keys.p256dh` and `keys.auth` SHALL be non-empty base64url strings. Invalid tokens SHALL be rejected with `400`.

#### Scenario: Server restart preserves tokens
- **WHEN** token registered, server restarts
- **THEN** token still present

#### Scenario: Idempotent registration by endpoint
- **WHEN** same `deviceToken.endpoint` registered twice
- **THEN** one entry with updated `lastUsedAt`

#### Scenario: Register with non-HTTPS endpoint → rejected
- **WHEN** `deviceToken.endpoint` is `http://...`
- **THEN** `400 Bad Request`

#### Scenario: Register with missing keys → rejected
- **WHEN** `deviceToken.keys` is empty or malformed
- **THEN** `400 Bad Request`

#### Scenario: Dead-token pruning
- **WHEN** transport returns `{ok: false, gone: true}`
- **THEN** token removed from registry and persistence

### Requirement: Web Push transport with extensible interface

Transport SHALL implement:

```ts
interface PushTransport {
  kind: string;  // "web-push" for v1; extensible
  send(token: PushToken, payload: PushPayload, opts?: { signal?: AbortSignal }): Promise<{ok: boolean; gone?: boolean}>;
}
```

The dispatcher SHALL accept `transports: Map<string, PushTransport>` keyed by `kind` so it can route by `token.transport` and skip unknown kinds.

#### Scenario: Web Push transport sends successfully
- **WHEN** token with `transport: "web-push"` dispatched
- **THEN** transport's `send` called with token, payload, and `signal`; 201 → `{ok: true}`

#### Scenario: Unknown transport → skipped
- **WHEN** token has unrecognized `transport`
- **THEN** token skipped with logged warning; no crash

### Requirement: VAPID key lifecycle

Server SHALL generate VAPID keypair on first start with `push.enabled: true`, persist to `~/.pi/dashboard/push-vapid.json` with `0600` permissions. Keypair reused across restarts. Public key exposed via `GET /api/push/vapid-public-key`.

#### Scenario: Keypair generated once
- **WHEN** first start with `push.enabled: true`
- **THEN** `push-vapid.json` created with owner-only permissions

#### Scenario: Keypair reused
- **WHEN** restart with file present
- **THEN** existing keypair loaded; no regeneration

#### Scenario: Public key endpoint
- **WHEN** `GET /api/push/vapid-public-key` (authenticated)
- **THEN** `200 {publicKey: "<base64url>"}`

### Requirement: Push REST API (6 endpoints, auth-gated, rate-limited)

All endpoints SHALL participate in existing auth chain. Rate limits SHALL apply per caller.

| Method | Path | Body | Response | Rate |
|--------|------|------|----------|------|
| `POST` | `/api/push/register` | `{deviceToken: PushSubscriptionJSON, transport?}` | `200 {tokenId, registered: true}` | 10/min |

Register SHALL default `transport` to `"web-push"` when omitted. Non-`"web-push"` transport values SHALL be rejected with `400` in v1. `deviceToken.endpoint` SHALL be HTTPS. `deviceToken.keys.p256dh` SHALL decode to 65 bytes (uncompressed P-256 key) and `keys.auth` SHALL decode to 16 bytes; invalid lengths SHALL be rejected with `400`.
| `DELETE` | `/api/push/register/:tokenId` | — | `204` | 10/min |
| `GET` | `/api/push/tokens` | — | `200 {tokens: [{id, transport, endpointLast4, registeredAt, lastUsedAt}]}` — no full endpoint or keys | 30/min |
| `POST` | `/api/push/test` | `{tokenId?}` | `200 {results: [{tokenId, ok, gone?}]}` — uses `sendNow`, filters to `tokenId` | 5/min |
| `POST` | `/api/push/send` | `{title: ≤200, body: ≤500, url?: "/..."}` | `200 {results: [{tokenId, ok, gone?}]}` — uses `sendNow` to all | 2/min |
| `GET` | `/api/push/vapid-public-key` | — | `200 {publicKey}` | 30/min |

`/api/push/send` URL validation: SHALL start with exactly one `/` (not `//`), SHALL pass `new URL(url, "https://localhost")` same-origin check, SHALL reject `\\` and encoded protocol tricks. Audit-logged.

#### Scenario: Unauthenticated → 401
- **WHEN** any push endpoint without valid auth from non-loopback non-trusted host
- **THEN** `401`

#### Scenario: `/api/push/send` with `//evil.com` → rejected
- **WHEN** `url: "//evil.com/phish"`
- **THEN** `400 Bad Request`

#### Scenario: `/api/push/send` oversized → rejected
- **WHEN** title >200 or body >500
- **THEN** `400 Bad Request`

#### Scenario: Rate limit → 429
- **WHEN** third `/api/push/send` within 60s
- **THEN** `429 Too Many Requests`

#### Scenario: `GET /api/push/tokens` returns safe shape
- **WHEN** called
- **THEN** each token has `{id, transport, endpointLast4, registeredAt, lastUsedAt}`; NO full endpoint, NO keys

### Requirement: Opt-in by default with normalized config

Config normalization SHALL work as follows:
- No `push` block → `{enabled: false}`
- `push.enabled: false` → no dispatcher, no routes, no VAPID → `/api/push/*` returns `404`
- `push.enabled: true` with missing `webPush.contactEmail` → `push.errors: ["missing contactEmail"]`. Server SHALL NOT mount push routes, SHALL NOT construct dispatcher or transport. `/api/push/*` SHALL return `503 {"error": "push_misconfigured", "details": "missing contactEmail"}`. `/api/health` SHALL include `push.errors`.

#### Scenario: Misconfigured → 503 on all push endpoints
- **WHEN** `push.enabled: true` but `contactEmail` missing
- **THEN** all `/api/push/*` endpoints SHALL return `503` with `{error: "push_misconfigured", details}`
- **AND** `/api/health` SHALL include `push: {errors: ["missing contactEmail"]}`

#### Scenario: Fresh config without push block
- **WHEN** no `push` key in config
- **THEN** `config.push.enabled === false`; no side-effects

#### Scenario: Push enabled but no contactEmail
- **WHEN** `push.enabled: true`, no `contactEmail`
- **THEN** transport not initialized; `GET /api/health` includes `push.errors: ["missing contactEmail"]`

#### Scenario: Disabled → 404
- **WHEN** `push.enabled !== true`, any `/api/push/*`
- **THEN** `404`

### Requirement: Service worker push handler

`public/sw.js` SHALL handle `push` events (parse JSON, show notification with fallbacks) and `notificationclick` (navigate or focus existing window). Notification click SHALL use exact pathname matching: `new URL(client.url).pathname === urlPath`, not substring `includes`.

#### Scenario: Valid JSON payload
- **WHEN** push event with `{title, body, url, sessionId}`
- **THEN** `showNotification` called with title, body, icon, badge, `data: {url, sessionId}`

#### Scenario: Malformed JSON → fallback
- **WHEN** `event.data.json()` throws
- **THEN** `showNotification` with title "Pi Dashboard", body from `event.data.text()` or "New activity"

#### Scenario: Empty push (no data)
- **WHEN** `event.data` is null
- **THEN** `showNotification` with "Pi Dashboard" / "New activity"

#### Scenario: Notification click navigates to URL
- **WHEN** `notificationclick` with `notification.data.url = "/session/abc"`
- **THEN** `clients.openWindow("/session/abc")` — using exact pathname match

#### Scenario: Click focuses existing window at same pathname
- **WHEN** a client window already has `pathname === "/session/abc"`
- **THEN** that window SHALL be focused; no new window opened

#### Scenario: Click with no URL → dashboard root
- **WHEN** `notification.data.url` is undefined
- **THEN** `clients.openWindow("/")`

### Requirement: Client subscription hook with VAPID key and token reconciliation

`usePushSubscription` hook SHALL expose `{supported, status, subscribe(), unsubscribe(), sendTest()}`.

`subscribe()` flow:
1. Request notification permission
2. `GET /api/push/vapid-public-key` → decode base64url public key to `Uint8Array`
3. `swReg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: uint8Key})`
4. `POST /api/push/register` with full subscription → store returned `tokenId`

On mount: reconcile — check existing `swReg.pushManager.getSubscription()`, if present POST to `/api/push/register`, store `tokenId`.

`unsubscribe()`: call `PushSubscription.unsubscribe()` AND `DELETE /api/push/register/:tokenId`.

#### Scenario: Subscribe with VAPID key
- **WHEN** user triggers `subscribe()`
- **THEN** hook SHALL fetch VAPID public key, decode to `Uint8Array`, pass as `applicationServerKey`
- **AND** status SHALL be `'subscribed'`

#### Scenario: Mount with existing subscription → reconcile
- **WHEN** mount detects existing `PushSubscription`
- **THEN** hook SHALL POST to `/api/push/register` and store `tokenId`

#### Scenario: Unsubscribe cleans both sides
- **WHEN** `unsubscribe()` called
- **THEN** browser subscription SHALL be cancelled AND server token SHALL be deleted

#### Scenario: Permission denied
- **WHEN** `NotAllowedError` on subscribe
- **THEN** status SHALL be `'denied'`

#### Scenario: Non-secure context
- **WHEN** `PushManager` unavailable (HTTP origin)
- **THEN** `supported: false`; no crash

### Requirement: On-demand push endpoint with safety guards

`POST /api/push/send` SHALL accept `{title: ≤200, body: ≤500, url?: "/..."}`. Uses `sendNow` (bypasses coalescing, returns per-token results). Enforces 2/min rate limit. URL validated: single leading `/`, not `//`, same-origin. Audit-logged.

#### Scenario: Send push to all devices
- **WHEN** `{title: "Done", body: "Refactoring complete"}`
- **THEN** all devices receive push; `200 {results: [...]}`

#### Scenario: No devices → empty results
- **WHEN** no tokens registered
- **THEN** `200 {results: []}`

#### Scenario: Coalescing bypass
- **WHEN** auto-trigger push at t=0, `/api/push/send` at t=5s
- **THEN** both delivered

#### Scenario: URL with double-slash → rejected
- **WHEN** `url: "//evil.com/phish"`
- **THEN** `400`

#### Scenario: Rate limit → 429
- **WHEN** third call within 60s
- **THEN** `429`

### Requirement: Push-notify-user skill with error handling

`.pi/skills/push-notify-user/SKILL.md` teaches agents to call `POST /api/push/send`. The skill SHALL also be bundled with the bridge extension at `packages/extension/.pi/skills/push-notify-user/` so that `pi install @blackbelt-technology/pi-dashboard-extension` automatically installs the skill. Authentication: the skill SHALL work via loopback (agent runs on same machine as dashboard). The skill SHALL read `auth.secret` from `~/.pi/dashboard/config.json` (nested under `auth` key) and pass it as `Authorization: Bearer <secret>` header. The auth-plugin SHALL be extended to validate `Authorization: Bearer <auth.secret>` before cookie/JWT validation. Handle all failure modes.

#### Scenario: Successful push
- **WHEN** agent invokes skill, endpoint returns 200
- **THEN** agent reports "Push sent"

#### Scenario: Dashboard unreachable
- **WHEN** dashboard not running
- **THEN** agent reports "Dashboard not reachable — push not sent"

#### Scenario: Auth failure → 401
- **WHEN** endpoint returns 401
- **THEN** agent reports "Auth failed — check dashboard config"

#### Scenario: Push disabled → 404
- **WHEN** endpoint returns 404
- **THEN** agent reports "Push notifications not enabled on this server"

#### Scenario: No devices → empty results
- **WHEN** `200 {results: []}`
- **THEN** agent reports "No devices registered for push notifications"

#### Scenario: Rate limited → 429
- **WHEN** endpoint returns 429
- **THEN** agent reports "Rate limited — wait before sending another push"

### Requirement: Service worker unit tests

`packages/client/src/__tests__/sw-push.test.ts` SHALL cover 7 scenarios.

#### Scenario: Valid JSON → correct showNotification
#### Scenario: Malformed JSON → fallback
#### Scenario: Empty push → defaults
#### Scenario: Click with URL → openWindow
#### Scenario: Click without URL → openWindow("/")
#### Scenario: Click focuses existing window at same pathname (exact match, not substring)
#### Scenario: Non-secure context → supported: false
