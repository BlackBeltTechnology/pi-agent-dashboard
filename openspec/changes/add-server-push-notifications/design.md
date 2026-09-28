## Context

The dashboard already decides "the user should know about this session" server-side. `isUnreadTrigger(eventType, before, after, payload)` (`packages/server/src/session/event-status-extraction.ts:263`) fires on three edges: turn finished (`streaming → idle/active`), waiting for input (`currentTool → "ask_user"`), crash (`agent_end` with truthy error). Its only consumer is the helper `stampUnreadIfTriggered` in `packages/server/src/event-wiring.ts:662`:

```ts
function stampUnreadIfTriggered(sessionId, eventType, before, after, payload?): void {
  if (!viewedSessionTracker) return;
  if (!isUnreadTrigger(eventType, before, after, payload)) return;
  if (viewedSessionTracker.isViewedByAnyone(sessionId)) return;
  const session = sessionManager.get(sessionId);
  const unreadEdge = !!session && !session.unread;              // ← NEW
  if (unreadEdge) {
    sessionManager.update(sessionId, { unread: true });
    browserGateway.broadcastSessionUpdated(sessionId, { unread: true });
  }
  if (session) pushDispatcher?.fanout(sessionId, { eventType, after, payload, unreadEdge }); // ← NEW
}
```

The helper has **two callers**: the `event_forward` path (`event-wiring.ts:944`, gated by `!replayingSessions.has(sessionId) && viewedSessionTracker` at `:941`) and the `prompt_request` branch (`event-wiring.ts:2058`, which passes `eventType = "prompt_request"` and **no payload**). Both evaluate the same trigger on purpose, because the `prompt_request` branch writes `currentTool` without reaching the extractor. So one `ask_user` edge can reach the helper twice, milliseconds apart. The helper is synchronous, so the second call sees `unread === true`. Replay never reaches the helper, but by two different mechanisms: `event_forward` checks `replayingSessions` explicitly, while the `prompt_request` branch is structurally live-only. Any new caller must keep replay out.

`unread` is cleared only by a browser `session_view` (`packages/server/src/pairing/browser-gateway.ts:1969`). That fact drives Decision 10.

Some paths deliberately do not go through the helper: the exemption at `event-wiring.ts:1202` and the heartbeat liveness heal. Neither stamps unread, and neither pushes.

**Stakeholders**: server maintainers (event-wiring + new push module), web client maintainers (repo-root `public/sw.js`, served via `publicDir` in `packages/client/vite.config.ts`; `usePushSubscription`, Settings UI), the future Capacitor change author (reuses `/api/push/register`), webhook consumers (nanoMuse, ntfy, Home Assistant).

**Dependencies**:
- Existing: `stampUnreadIfTriggered`, `viewedSessionTracker` (`packages/server/src/session/viewed-session-tracker.ts`), `writeJsonFile` / `readJsonFile` (`packages/server/src/persistence/json-store.ts`), the auth chain (`packages/server/src/auth/auth-plugin.ts`), the route-tier map (`packages/shared/src/route-tiers.ts`), the config validators in `packages/shared/src/config.ts`.
- New npm: `web-push` (MIT) and `undici` (MIT, Node's own HTTP client). The webhook transport needs `undici`'s `request` plus an `Agent` with a `connect.lookup` hook for address pinning, which global `fetch` does not expose. FCM uses built-in `fetch` + `crypto.createSign`. No Firebase SDK.

## Goals / Non-Goals

**Goals:**
- One decision point for "is this event push-worthy": `stampUnreadIfTriggered`. No second evaluation of `isUnreadTrigger`.
- Push never blocks the event pipeline: `fanout` does no I/O and no disk read synchronously, and never throws or rejects.
- Device transports push once per unread period per session. Webhooks receive every qualifying trigger. Both are bounded by a per-(session, token) coalescing window (Decision 10).
- Three transports (Web Push, FCM, generic webhook) behind one `PushTransport` interface.
- Opt-in (`config.push.enabled` defaults to false): no dispatcher, no VAPID keys and no outbound calls while disabled.
- Web Push works on the existing PWA; no Capacitor needed for v1.
- The Capacitor follow-on ships by registering `transport: "fcm"` tokens, with no trigger-logic change.

**Non-Goals:**
- Changing `isUnreadTrigger` or the unread gating. Trigger semantics are shared with the stripes feature; changing them is its own change.
- A notification framework (categories, priorities, sounds). v1 has three trigger kinds and one payload shape.
- Replacing the unread WebSocket broadcast for connected browsers.
- Delivery receipts, retry or a dead-letter queue.

## Decisions

### Decision 1: Coalescing applies to webhook tokens, keyed `(sessionId, tokenId)`

A phone and a desktop each get their own push. `tokenId` is stable per `deviceToken`: registration is idempotent (Decision 4), so re-subscribing keeps the same `tokenId` and does not reset the window. The in-memory map drops entries older than `2 × coalesceWindowMs` on each dispatch, and `registry.remove(tokenId)` also deletes that token's entries. Size is bounded by `O(sessions × tokens)`.

Device tokens are **not** coalesced. The unread edge already limits them to one per unread period, and a new period requires a view. Coalescing them would swallow a real new edge that arrives within the window after the user looked at the session. For webhook tokens, coalescing is the rate bound, and it absorbs the double caller for one `ask_user` edge.

### Decision 2: Web Push via VAPID, keys persisted at `~/.pi/dashboard/push-vapid.json` (mode `0600`)

Generated once so existing browser subscriptions survive restarts. The file holds the signing private key, so it is written `0600` (Decision 11).

**Rejected alternative**: deriving the keys from `config.secret`. Rotating the secret would silently invalidate every subscription.

### Decision 3: FCM via HTTPS + service-account JWT, no Firebase Admin SDK

One `fetch` POST to `https://fcm.googleapis.com/v1/projects/<project_id>/messages:send`, with a Bearer token from an OAuth JWT signed by `crypto.createSign('RSA-SHA256')`. The token is cached and refreshed on 401 or at 3500 s. About 80 LOC.

**Rejected alternative**: `firebase-admin`, which pulls a large gRPC/Firestore dependency tree for one POST.

### Decision 4: Token registry is one JSON file, held in memory

Loaded once at dispatcher construction. Reads (`list`, match) are served from memory, so `fanout` never touches disk. `add` and `remove` update memory and write through immediately with the atomic tmp+rename write at mode `0600` (Decision 11). `touch` (`lastUsedAt`) is persisted at most once per 60 s, so a busy session does not rewrite the file on every push. A crash can lose up to 60 s of `lastUsedAt`, which is harmless.

If the file does not parse at load, the registry logs an error, renames it to `push-tokens.json.corrupt-<epoch ms>` (keeping it for inspection), starts empty, and adds a `push.errors` entry. Push stays enabled.

`add` is idempotent by `deviceToken`: an existing entry keeps its `id` and gets a new `lastUsedAt`. The registry holds at most **50** tokens. A 51st *distinct* `deviceToken` gets `409`, while re-registering an existing one is still allowed.

**Registration validation** (all failures → `400`):
- `transport` ∈ {`web-push`, `fcm`, `webhook`}.
- `web-push`: `deviceToken` is the JSON of a `PushSubscription` (`{endpoint, keys: {p256dh, auth}}`) with an `https:` endpoint and both keys non-empty.
- `fcm`: a non-empty string.
- `webhook`: Decision 9 rules.
- `label`: ≤ 64 chars.
- `sessionFilter`: an array of ≤ 100 non-empty strings.

The Web Push endpoint is a capability URL, so it is a secret like a webhook URL. `display` for web-push is `"<push-service host> browser"` (e.g. `fcm.googleapis.com browser`), never the endpoint path. For fcm it is `"fcm device"`.

### Decision 5: Payload is small and links to the session

```json
{ "type": "session_attention", "trigger": "input", "sessionId": "abc-123", "title": "fix-login: waiting for input", "body": "claude-opus-5", "url": "/session/abc-123" }
```

Built server-side by the pure helper `buildPushPayload(session, {eventType, after, payload})`.
- `trigger` is one of `turn_end`, `input`, `crash`.
- `title` is `"<name>: turn finished"`, `"<name>: waiting for input"` or `"<name>: crashed"`. `<name>` is the session name, falling back to the basename of the session's cwd.
- `body` is the session's model id (empty if unknown). For a crash it is the error message, cut to 200 characters with `…` appended when longer.

No other event content is included. It fits the roughly 4 KB Web Push and FCM limits.

### Decision 6: `push.enabled` defaults to false; routes answer 404 while disabled

A missing or partial `push` block parses to `{enabled: false, coalesceWindowMs: 30000}`. While disabled:
- no dispatcher is built;
- no VAPID keys are generated;
- no transport makes an outbound call.

The `/api/push/*` routes are **always registered**, which keeps the route-tier completeness test static, but their handlers answer `404` while disabled. The auth chain runs first, so an unauthenticated caller gets `401` regardless and cannot probe whether push is enabled.

### Decision 7: `pushDispatcher?` is optional in `EventWiringDeps`

Mirrors `viewedSessionTracker?`. Tests that don't exercise push stay lean.

**Coupling, stated on purpose**: `stampUnreadIfTriggered` returns early when `viewedSessionTracker` is absent, so push also requires the tracker. Production always wires both. The dispatcher is only constructed in the same `server.ts` path that passes the tracker, and a test asserts that pairing.

### Decision 8: Gone tokens are pruned

Web Push `404`/`410`, FCM `NOT_FOUND`/`UNREGISTERED` and webhook `410` return `{ok: false, gone: true}`. The dispatcher then calls `registry.remove(tokenId)`. No reaper job.

### Decision 9: Generic webhook transport; the URL is the token and a secret

**Why**: a device is not the only useful consumer. A self-hosted agent (nanoMuse `hook` triggers at `POST /api/hooks/{id}?key=…`), ntfy, Home Assistant or a CI bot can act on "session needs attention". The dashboard's MCP endpoint cannot carry this for SDK clients: `subscriptions/listen` streaming exists only in the modern era, and clients that call `initialize` negotiate the legacy era, where streaming is refused (`packages/mcp-server-plugin/README.md`).

**Shape**: `transport: "webhook"`, `deviceToken` = absolute `http:`/`https:` URL, plus an optional user-supplied `label` (≤ 64 chars). The body is the Decision 5 payload with `Content-Type: application/json`. It adds one file in `push-transports/` and no new trigger logic.

**Hardening** (`security-hardening`):
- Registration validates with `new URL()`. A non-`http:`/`https:` scheme, a relative URL, or userinfo (`user:pass@`) gets `400`. The WHATWG parser canonicalises numeric hosts (`http://2852039166/` → `169.254.169.254`), so the block check runs on the parsed hostname and on the resolved addresses.
- **SSRF policy.** Loopback and private-LAN targets are allowed; a nanoMuse on the same box or the LAN is the main use case. The dashboard itself is refused: a target whose port equals the dashboard's listen port on a loopback or local-interface address gets `400`, because loopback requests pass the local-trust checks and a hook pointed at `/api/restart` would fire on every trigger. Link-local and cloud-metadata addresses are refused: `169.254.0.0/16`, `fe80::/10` and `fd00:ec2::254`, plus IPv4-mapped forms of these. The check runs at registration and **again at every delivery**. If **any** resolved address is blocked, the request is refused, identically at both points. Delivery uses an `undici` `Agent` whose `connect.lookup` hands back only the vetted addresses, which closes the DNS-rebinding gap between check and connect.
- Delivery uses `undici.request`, which follows no redirects, so a 3xx counts as a failure. It is bounded by a 5 s timeout. The response body is discarded with `body.dump()`, so the socket is released.
- **The URL is a secret.** API responses and log lines render a webhook token as `label` (if set) plus its origin, never the path or query. Transport errors are logged as `{transport, target: <redacted>, status | errorCode}`. The raw `Error` object is never logged, because `fetch` errors can carry the full URL in `cause`.
- `POST /api/push/test` returns `{tokenId, ok}` per token, with `gone` for pruned tokens. It never returns an HTTP status, error text or timing, so it cannot be used to probe which hosts are reachable. It bypasses coalescing, because a test must really send. Repeated use is bounded by its `operate` tier, a caller who could already spawn shell sessions.

**Outcome mapping**:
- `2xx` → `{ok: true}`.
- `410` → `{ok: false, gone: true}`, and the token is pruned.
- `404` → `{ok: false}`, token **kept**. A reverse proxy or a restarting receiver can answer 404 for a moment, and a webhook consumer has no way to learn it was pruned. Each token carries `consecutiveFailures` (in memory, reset on success), and the list shows it so the user can spot a dead hook and remove it.
- Every other status, a network error, a refused address or a timeout → `{ok: false}`. The failure is logged, the token is kept, and nothing is retried.

**Rejected alternative**: a separate `webhooks` config block. Reusing the token registry gives register, unregister, test, list, coalescing and pruning for free, plus the Settings UI.

### Decision 10: Hybrid cadence: device tokens on the unread edge, webhooks on every trigger

`fanout(sessionId, {eventType, after, payload, unreadEdge})` is called on every qualifying trigger: `isUnreadTrigger` true, no viewer, not a replay. The dispatcher then filters by transport:
- **Device tokens** (`web-push`, `fcm`) are delivered only when `unreadEdge` is true. A person gets one buzz per unread period, the same contract as the stripes. The next one comes after they view the session.
- **Webhook tokens** are delivered on every qualifying trigger, bounded by coalescing. A headless consumer (nanoMuse, ntfy, a CI bot) never views a session, so `unread` would never clear for it. Edge-only delivery would give it one event per session, ever.

`buildPushPayload` classifies the trigger from `(eventType, after, payload)`, not from `eventType` alone. A `prompt_request` call with `after.currentTool === "ask_user"` and no payload is the "waiting for input" trigger.

**Rejected**: uniform every-trigger delivery, which repeats buzzes on people who chose not to look. Also rejected: uniform edge-only delivery, which starves headless consumers.

### Decision 11: Secret-bearing files are written `0600`

`writeJsonFile` gains an optional `{ mode }` argument. With a mode set, it writes the `.tmp` file, then `chmodSync(tmp, mode)` **unconditionally** before the rename. `writeFileSync`'s `mode` only applies when the file is created, so a stale `.tmp` left by a crash would otherwise keep `0644`. The renamed file is therefore always `0600`. `push-tokens.json` and `push-vapid.json` use `0600`. Existing callers are unchanged.

### Decision 12: Route tiers

`packages/shared/src/route-tiers.ts` gets five rows:
- `GET /api/push/vapid-public-key`: `observe`.
- `GET /api/push/register`, `POST /api/push/register`, `DELETE /api/push/register/:tokenId`, `POST /api/push/test`: `operate`. A webhook registration is an outbound-request primitive, and the list reveals internal receiver origins.

The MCP manifest does not expose push tools in v1. The five routes go on `DENYLIST` in `packages/mcp-server-plugin/src/server/tools.denylist.ts`, because `mcp-manifest-completeness.test.ts` requires every registered route to be either bound or denylisted, and every `/api/*` route to have a `ROUTE_TIERS` row.

## Risks / Trade-offs

- **Payload size (about 4 KB)**: fits comfortably. Richer payloads would need a revisit.
- **iOS Web Push** requires installing the PWA to the home screen. The Settings UI shows a hint for iOS users. The Capacitor follow-on avoids this.
- **Missing VAPID contact email**: Web Push is disabled with a logged error and a `push.errors` entry on `/api/health`. FCM and webhook keep working. `/api/health` is unauthenticated (`system-routes.ts:84`), so `push.errors` is included only when `canDiscloseAccessPosture(request)` holds, the same gate as other posture data. The health-shape tests (`health-shape.test.ts`, `health-compatibility.test.ts`) are updated.
- **FCM service-account JSON** is read by path and never inlined in `config.json`.
- **Background tab counts as "viewing"**: `isViewedByAnyone` is true while any browser has the session selected, even in a hidden tab, so the phone stays silent. This is inherited from the unread gating (`openspec/specs/viewed-session-unread-gating`). Changing it belongs to that capability.
- **Webhook receivers can rate-limit**: nanoMuse refuses a hook called again within 10 s (`429`). Decision 10 makes bursts from one session rare. Several sessions finishing together can still hit one receiver's limit; the `429` is logged and not retried. Accepted for v1.
- **Webhook targets see the title and body text**: the same payload as a device push, but it leaves the device-push trust boundary. The user chose the URL.
- **Dead webhook stays registered**: a deleted nanoMuse hook answers `404` forever. The token is kept, the failure is logged each time, and the list shows its `consecutiveFailures` count. The user removes it.
- **Web Push needs a secure context**: `pushManager.subscribe` works only over `https://` or `localhost`. On a plain-http LAN address the Settings section says so and points at the webhook path (ntfy, nanoMuse) or an https tunnel (zrok). FCM and webhook are unaffected.
- **Single-user fan-out**: every registered token receives every session's events. With multiple OAuth users, titles can reach another user's device or webhook. `userId` is recorded for a follow-up; multi-user routing is out of scope.
- **Fire-and-forget lint is heuristic**: the AST test catches a direct `await`/`.then` on `fanout`, not aliasing. The real guarantee is structural: `fanout` returns `void`, does no synchronous I/O, and wraps its async work in a `.catch` that logs. That is unit-tested.

## Migration Plan

Purely additive:

1. Server: `writeJsonFile` mode option, dispatcher, transports, routes, route tiers and config schema. With the default `enabled: false` nothing changes.
2. Client: `usePushSubscription`, the `public/sw.js` push handler, and the Settings section (device list plus "Add webhook URL"). When the server answers 404, the section shows "Push not enabled on this server".
3. The user sets `push.enabled: true`, then enables Web Push on a device or adds a webhook URL in Settings.
4. The Capacitor follow-on registers `transport: "fcm"` tokens with no server change beyond `push.fcm.serviceAccountPath`.

Rollback: set `push.enabled: false`, or remove the block. The token and VAPID files are inert while disabled and can be deleted.
