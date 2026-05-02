## Context

The dashboard's `event-wiring.ts` already classifies "user-relevant" events via the pure helper `isUnreadTrigger(eventType, before, after, payload)` (`event-status-extraction.ts:209`). That classifier is the single source of truth for "should the user be notified?" — currently consumed only by the unread-stripes feature. Push notifications are the natural extension of the same trigger to disconnected devices.

The fan-out site is a single point in `event-wiring.ts:188-201`:

```ts
if (
  isUnreadTrigger(msg.event.eventType, beforeSnapshot, afterSnapshot, msg.event.data) &&
  !viewedSessionTracker.isViewedByAnyone(sessionId)
) {
  if (sessionAfter && !sessionAfter.unread) {
    sessionManager.update(sessionId, { unread: true });
    browserGateway.broadcastSessionUpdated(sessionId, { unread: true });
  }
  pushDispatcher?.fanout(sessionId, msg.event); // ← THE NEW LINE
}
```

This co-location is deliberate: push and unread-stripes have identical semantics ("notify because the user wants to know"). Diverging the gating would create two parallel-but-subtly-different "what counts as a notable event" definitions, which is a long-term maintenance hazard.

**Stakeholders**: server maintainers (event-wiring + new push module), web client maintainers (sw.js + usePushSubscription hook + Settings UI), future Capacitor change author (will reuse `/api/push/register`).

**Dependencies**:
- Existing: `viewedSessionTracker`, `isUnreadTrigger`, `event-wiring.ts`, `auth-plugin.ts`, `json-store.ts`, `config.ts` validator pattern.
- New npm: `web-push` (~2.5k weekly downloads is a misread — it's millions; widely used, stable, MIT-licensed). FCM uses native `https` + `crypto.createSign` for the JWT; no Firebase SDK.

## Goals / Non-Goals

**Goals:**
- One place in the codebase decides "is this event push-worthy?" — `isUnreadTrigger`. No duplication.
- Push delivery latency must not block the event-forwarding pipeline. Failure of FCM/APNs/Web Push must not throttle the websocket fan-out to connected browsers. Enforced by a repo-level lint test.
- Coalesce per-(session, device) at 30s — same window the existing `lastActivityBroadcastAt` uses. Configurable, clamped 5–300s.
- Two transports (Web Push, FCM) behind one `PushTransport` interface. Adding APNs-direct or another transport later is mechanical.
- Server is opt-in (`config.push.enabled = false` by default). A user who never touches the config sees zero behavior change.
- Web Push works on the existing PWA — no Capacitor required for v1 value.
- The Capacitor follow-on can ship by adding ONE transport adapter and zero changes to the trigger logic.

**Non-Goals:**
- Modifying `isUnreadTrigger` itself. Trigger semantics are already in production for the unread feature; if they need to evolve, that's its own change touching both consumers.
- Building a generic notification framework (categories, priorities, sound packs). v1 is "ping me when the agent needs me" — three trigger types, one notification body shape.
- Replacing the existing unread-stripes broadcast with a push round-trip. Connected browsers continue to learn via WebSocket; push is for *disconnected* devices.
- Server-side delivery receipts / retry / DLQ. Web Push and FCM both have transport-level retry. Our dispatcher logs failure and moves on. If a device is permanently dead, the next 410 / `UNREGISTERED` response prunes it from the registry.

## Decisions

### Decision 1 — Coalescing key is `(sessionId, deviceToken)`, not `(sessionId)`

**Why**: a user with a phone AND a desktop both registered should each get the push, even though they're "the same user." Coalescing per-token avoids one device suppressing another. The 30s window is per-pair.

**Tradeoff**: in-memory map size grows with `O(active sessions × registered devices)`. Bounded by entry count and TTL — old entries pruned on every dispatch (lazy expiry). For a 50-session, 5-device household: 250 entries max. Negligible.

### Decision 2 — Web Push via VAPID, server-generated keys, persisted at `~/.pi/dashboard/push-vapid.json`

**Why**: VAPID is the standard auth scheme for Web Push. Generating once and persisting (rather than re-generating per server start) means existing browser subscriptions remain valid across restarts. The VAPID public key is embedded in the subscription request and validated by the push service (Mozilla autopush, FCM under the hood for Chrome, etc.).

**Tradeoff**: one more JSON file in `~/.pi/dashboard/`. Acceptable.

**Rejected alternative**: VAPID keys derived from `config.secret`. Risk: rotating the secret would invalidate all push subscriptions silently, with no failure surface until a user wonders why pushes stopped. Separate persistence makes the lifecycle explicit.

### Decision 3 — FCM via raw HTTP/2 + service-account JWT, no Firebase Admin SDK

**Why**: Firebase Admin SDK is ~50MB of dependencies for one HTTP call. The FCM v1 API is a single POST with a Bearer JWT; the JWT signing uses `crypto.createSign('RSA-SHA256')` from Node built-ins. Total: ~80 LOC, zero new heavyweight deps.

**Tradeoff**: we manually handle token refresh (JWT expires after 1 hour). Mitigation: cache token, refresh on 401. ~10 extra LOC.

**Rejected alternative**: Firebase Admin SDK. Pulls `@grpc/grpc-js`, `firebase-admin`, `@google-cloud/firestore`, etc. Bloats `node_modules` by ~80MB. Not justified for one POST call.

### Decision 4 — Token persistence as a single JSON file, not SQLite

**Why**: matches the existing pattern (`session-meta`, `preferences-store`, `known-servers`). All token mutations go through the existing `json-store.ts` atomic write. For < 1000 tokens (which is FAR more than any single user has) JSON read/write is microseconds.

**Tradeoff**: full-file rewrite on every register/unregister. Negligible at expected scale.

### Decision 5 — Notification payload is small and links to the session

The push payload is:
```json
{ "type": "session_attention", "sessionId": "abc-123", "title": "Pi session waiting for input", "body": "agent: claude — file_edit", "url": "/session/abc-123" }
```

Title/body computed server-side from event payload + session metadata. Click handler in `sw.js` (and Capacitor's plugin handler in the follow-up) navigates to `url`. We do NOT include the full event content — privacy + payload-size limits (FCM caps at 4KB, Web Push at 4KB nominal).

### Decision 6 — `push.enabled = false` by default; opt-in in Settings UI

**Why**: pushing requires user consent at the OS level anyway (browser prompt for Web Push, OS permission for FCM via Capacitor). Server-side opt-in is the second gate — admins who don't want push noise on their server don't need to do anything. Mirrors `tunnel.enabled`.

### Decision 7 — `pushDispatcher?` is optional in `EventWiringDeps`

Mirrors how `viewedSessionTracker?` was added. Keeps existing tests that don't exercise push lean. The runtime `wireEvents` call in `server.ts` always passes the dispatcher in production.

### Decision 8 — Failed deliveries with `410 Gone` (Web Push) or `NOT_FOUND` / `UNREGISTERED` (FCM) prune the token

The dispatcher records and removes dead tokens automatically. No background reaper job. This keeps the token registry clean without a polling cron.

## Risks / Trade-offs

- **Web Push payload size limit (4KB)**. Title + body + url + sessionId fits comfortably. Risk if we ever want richer payloads.
- **iOS Safari Web Push** requires the user to install the PWA to the home screen. Documented behavior; we surface a hint in the Settings UI for iOS users ("install to home screen first"). The Capacitor follow-on side-steps this entirely via APNs through FCM.
- **VAPID contact email is required by spec**. If `config.push.webPush.contactEmail` is missing while Web Push is enabled, server logs a clear error and disables Web Push (FCM still works). Documented in design + surfaced in `/api/health.push.errors`.
- **FCM service-account JSON is sensitive**. We read by path, do NOT inline in `config.json`. Ensures the file can have stricter permissions and isn't accidentally exposed in `/api/config` GET (which redacts secrets but should never see this content at all).
- **Test endpoint `/api/push/test` could be abused** to spam a user. Auth-gated and rate-limited by the existing auth-plugin chain. Acceptable for v1 single-user audience.
- **Coalescing window of 30s could miss a user**. If three trigger events fire within 30s, the user sees one push, not three. This is a feature, not a bug — same as the existing unread-stripes behavior. Configurable per deployment.

## Migration Plan

This is purely additive:

1. Land server-side dispatcher + REST routes + config schema. Default `enabled: false` means no behavior change for existing deployments.
2. Land client-side `usePushSubscription` + `sw.js` push handler + Settings UI. With server `enabled: false`, the UI shows "Push not enabled on this server" and the hook no-ops.
3. User opts in via config (or a follow-up "enable push" button in Settings if we want UX polish — out of scope for v1).
4. User clicks "Enable on this device" in Settings → browser prompt → token registered.
5. Capacitor change (follow-on) reuses `/api/push/register` with `transport: "fcm"`. Server-side requires only that `config.push.fcm.serviceAccountPath` is set.

No data migration. No breaking change. Existing unread-stripes behavior is untouched.
