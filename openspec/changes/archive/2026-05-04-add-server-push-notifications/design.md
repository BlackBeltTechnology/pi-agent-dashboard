## Context

The dashboard's `event-wiring.ts` already classifies "user-relevant" events via `isUnreadTrigger(eventType, before, after, payload)`. Push notifications introduce a **separate, narrower** predicate: `isPushTrigger` — matching only `ask_user` (agent needs input) and `agent_end`-error (agent crashed). Both predicates share the same call site but evaluate independently.

The fan-out site in `event-wiring.ts` will look like:

```ts
// Unread broadcast (broad set of triggers)
if (
  isUnreadTrigger(msg.event.eventType, beforeSnapshot, afterSnapshot, msg.event.data) &&
  !viewedSessionTracker.isViewedByAnyone(sessionId) &&
  !msg.event.replay
) {
  if (sessionAfter && !sessionAfter.unread) {
    sessionManager.update(sessionId, { unread: true });
    browserGateway.broadcastSessionUpdated(sessionId, { unread: true });
  }
}

// Push fan-out (narrow set of triggers + stale-view TTL)
if (
  isPushTrigger(msg.event.eventType, beforeSnapshot, afterSnapshot, msg.event.data) &&
  !viewedSessionTracker.isViewedByAnyone(sessionId, { staleMs: 60_000 }) &&
  !msg.event.replay
) {
  pushDispatcher?.fanout(sessionId, sessionAfter, msg.event); // ← THE NEW LINE
}
```

This co-location keeps "what warrants a push" in one file, while the separate predicate prevents spam on routine turn completions. The 60s stale-view TTL ensures background tabs and sleeping laptops don't suppress push indefinitely.

**Stakeholders**: server maintainers (event-wiring + new push module), web client maintainers (sw.js + usePushSubscription hook + Settings UI), agent/skill authors (push-notify-user skill).

**Dependencies**:
- Existing: `viewedSessionTracker`, `isUnreadTrigger`, `event-wiring.ts`, `auth-plugin.ts`, `json-store.ts`, `config.ts` validator pattern.
- New npm: `web-push` (widely used, stable, MIT-licensed).

## Goals / Non-Goals

**Goals:**
- Push-worthy events defined by dedicated `isPushTrigger` predicate — distinct from `isUnreadTrigger`. Only `ask_user` and `agent_end`-error qualify. Routine `streaming→idle` is excluded.
- `fanout` wrapped in `try/catch`, per-send 10s timeout via `AbortController` passed to transport's `opts.signal`. Separate `sendNow` method for REST endpoints that need per-token results.
- Coalesce per-(session, device) at 30s — configurable, clamped 5–300s.
- Stale-view TTL of 60s on viewing gate — background tabs and sleeping laptops don't suppress push indefinitely.
- Web Push transport behind extensible `PushTransport` interface (`kind: string`, not union literal).
- Server is opt-in (`config.push.enabled = false` by default). A user who never touches the config sees zero behavior change.
- Web Push works on the existing PWA — no native app required for v1 value.
- Pi agents can send on-demand pushes via `POST /api/push/send` using the `push-notify-user` skill.

**Non-Goals:**
- Modifying `isUnreadTrigger` itself. Trigger semantics are already in production for the unread feature; if they need to evolve, that's its own change touching both consumers.
- Building a generic notification framework. v1 is "ping me when the agent needs me" — two triggers, one notification shape, safety guards on on-demand sends.
- Server-side delivery receipts / retry / DLQ. Web Push has transport-level retry. Dispatcher logs failure and moves on. Dead tokens (410) pruned automatically.
- Replacing the existing unread-stripes broadcast. Connected browsers continue to learn via WebSocket; push is for disconnected devices.

## Decisions

### Decision 1 — Separate `isPushTrigger` predicate, narrower than `isUnreadTrigger`

**Why**: `isUnreadTrigger` includes `streaming→idle` — fine for ephemeral visual stripes, disruptive for persistent OS notifications. A separate `isPushTrigger` matches only `ask_user` and `agent_end`-error. Both predicates live in `event-status-extraction.ts`; the call site in `event-wiring.ts` evaluates them independently but co-located.

**Tradeoff**: two predicates to maintain instead of one. Mitigated by sharing the same exact function shape and living in the same file.

### Decision 2 — Stale-view TTL of 60s on viewing gate

**Why**: the existing `viewedSessionTracker.isViewedByAnyone(sessionId)` returns true for any browser that has the session route open — including background tabs and sleeping laptops. Without a TTL, a desktop left open would permanently suppress phone pushes. A 60s TTL means: if no browser has *actively* viewed the session in the last 60 seconds, push fires.

**Tradeoff**: a user who is actively looking at a session but hasn't triggered a view refresh in 60s (e.g. reading long output) might get a push. Acceptable — better than missing critical `ask_user`/crash notifications.

**Rejected alternative**: per-device tracking (phone vs desktop). Requires device identity correlation, which adds complexity disproportionate to v1 scope.

### Decision 3 — Coalescing key is `(sessionId, deviceToken)`, not `(sessionId)`

**Why**: a user with a phone AND a desktop both registered should each get the push, even though they're "the same user." Coalescing per-token avoids one device suppressing another. The 30s window is per-pair.

**Tradeoff**: in-memory map size grows with `O(active sessions × registered devices)`. Bounded by entry count and TTL — old entries pruned on every dispatch (lazy expiry). For a 50-session, 5-device household: 250 entries max. Negligible.

### Decision 4 — Web Push via VAPID, server-generated keys, persisted at `~/.pi/dashboard/push-vapid.json`

**Why**: VAPID is the standard auth scheme for Web Push. Generating once and persisting (rather than re-generating per server start) means existing browser subscriptions remain valid across restarts. The VAPID public key is embedded in the subscription request and validated by the push service (Mozilla autopush, FCM under the hood for Chrome, etc.).

**Tradeoff**: one more JSON file in `~/.pi/dashboard/`. Acceptable.

**Rejected alternative**: VAPID keys derived from `config.secret`. Risk: rotating the secret would invalidate all push subscriptions silently, with no failure surface until a user wonders why pushes stopped. Separate persistence makes the lifecycle explicit.

### Decision 5 — Token persistence as a single JSON file with 0600 permissions

**Why**: matches the existing pattern (`session-meta`, `preferences-store`, `known-servers`). All token mutations go through `json-store.ts` atomic write. Files created with `0600` permissions — VAPID private key and push endpoints must not be readable by other local users.

**Tradeoff**: full-file rewrite on every register/unregister. Negligible at expected scale (<1000 tokens).

### Decision 6 — Notification payload is small and links to the session

The push payload is:
```json
{ "type": "session_attention", "sessionId": "abc-123", "title": "Pi session waiting for input", "body": "agent: claude — file_edit", "url": "/session/abc-123" }
```

Title/body computed server-side from event payload + session metadata. Click handler in `sw.js` navigates to `url`. We do NOT include the full event content — privacy + payload-size limits (Web Push nominal cap at 4KB).

### Decision 7 — `push.enabled = false` by default; opt-in in Settings UI

**Why**: pushing requires user consent at the OS level anyway (browser prompt for Web Push). Server-side opt-in is the second gate — admins who don't want push noise on their server don't need to do anything. Mirrors `tunnel.enabled`.

### Decision 8 — `pushDispatcher?` is optional in `EventWiringDeps`

Mirrors how `viewedSessionTracker?` was added. Keeps existing tests that don't exercise push lean. The runtime `wireEvents` call in `server.ts` always passes the dispatcher in production.

### Decision 9 — Failed deliveries with `410 Gone` prune the token

The dispatcher records and removes dead tokens automatically. No background reaper job. This keeps the token registry clean without a polling cron.

### Decision 10 — On-demand push via `POST /api/push/send` + `push-notify-user` skill

**Why**: beyond automatic event-triggered pushes, agents need a way to notify the user on demand ("notify me when done"). Adding a dedicated `/api/push/send` endpoint lets any authorized caller send an arbitrary push to all registered devices. The companion `push-notify-user` skill teaches the agent how to discover the dashboard URL and call this endpoint.

**Safety guards**: `/api/push/send` enforces 2/min rate limit per caller, validates `title` ≤200 chars and `body` ≤500 chars, validates `url` as relative path only, and audit-logs every send. These prevent the endpoint from becoming a spam vector while keeping it useful for agents.

**Coalescing bypass**: `/api/push/send` intentionally bypasses the automatic coalescing window — if the user explicitly asked for a push, it should arrive immediately, even if an automatic push fired 5 seconds ago.

**Skill design**: the `push-notify-user` skill auto-detects the dashboard URL, reads the auth secret from `~/.pi/dashboard/config.json`, and handles all failure modes: unreachable (connection refused), auth failure (401), push disabled (404), no devices (200 empty results), rate limited (429).

## Risks / Trade-offs

- **Web Push payload size limit (4KB)**. Title + body + url + sessionId fits comfortably. Risk if we ever want richer payloads.
- **iOS Safari Web Push** requires the user to install the PWA to the home screen. Documented behavior; we surface a hint in the Settings UI for iOS users ("install to home screen first").
- **VAPID contact email is required by spec**. If `config.push.webPush.contactEmail` is missing while Web Push is enabled, server logs a clear error and disables Web Push. Documented in design + surfaced in `/api/health.push.errors`.
- **Test endpoint `/api/push/test` could be abused** to spam a user. Auth-gated and rate-limited by the existing auth-plugin chain. Acceptable for v1 single-user audience.
- **Coalescing window of 30s could miss a user**. If two trigger events fire within 30s, the user sees one push, not two. This is a feature, not a bug. Configurable per deployment.

## Migration Plan

This is purely additive:

1. Land server-side dispatcher + REST routes + config schema. Default `enabled: false` means no behavior change for existing deployments.
2. Land client-side `usePushSubscription` + `sw.js` push handler + Settings UI. With server `enabled: false`, the UI shows "Push not enabled on this server" and the hook no-ops.
3. User opts in via config (or a follow-up "enable push" button in Settings if we want UX polish — out of scope for v1).
4. User clicks "Enable on this device" in Settings → browser prompt → token registered.
5. (Optional) The `push-notify-user` skill lets agents send on-demand pushes via `POST /api/push/send`.

No data migration. No breaking change. Existing unread-stripes behavior is untouched.
