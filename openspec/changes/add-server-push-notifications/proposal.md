## Why

The dashboard already has a server-side classifier — `isUnreadTrigger(eventType, before, after, payload)` in `packages/server/src/event-status-extraction.ts:209` — that fires when an agent finishes a turn (`streaming → idle/active`), waits for input (`currentTool → "ask_user"`), or crashes (`agent_end` with truthy error). Today this classifier flips a per-session `unread` bit and broadcasts `session_updated` to *connected* browsers (see `event-wiring.ts:181-201`). Disconnected, backgrounded, or mobile users learn nothing.

Push notifications close that gap. The same three triggers that drive the unread-stripes feature are exactly the moments a user wants their phone to ping. By wiring a fan-out dispatcher into the existing trigger site, we get cross-device awareness with **zero new event semantics** and one new line at the call site.

This change ships value to the existing PWA via the W3C Web Push spec (Chrome / Edge / Firefox / Safari 16+ on iOS) before any Capacitor work happens. The follow-on change `add-capacitor-mobile-shell` (not yet filed) will reuse the exact same server endpoints via Capacitor's `@capacitor/push-notifications` plugin (FCM/APNs through Firebase) — so the server-side mechanics are identical for both transports.

## What Changes

- **NEW** `packages/server/src/push/` module with three files:
  - `push-token-registry.ts` — persists `{deviceToken, transport: "web-push"|"fcm", userId?, sessionFilter?: string[], registeredAt, lastUsedAt}` to `~/.pi/dashboard/push-tokens.json` via the existing `json-store.ts` atomic write helper. Pure-data layer, no transport coupling.
  - `push-dispatcher.ts` — async fire-and-forget fan-out. Takes `(sessionId, event)` → reads matching tokens → POSTs to the appropriate transport endpoint. **Coalesces** at most one push per `(sessionId, deviceToken)` per 30s window, mirroring the existing `lastActivityBroadcastAt` throttle in `event-wiring.ts`. Failures logged, never thrown — must not block the event pipeline.
  - `push-transports/web-push.ts` and `push-transports/fcm.ts` — transport adapters with a shared `PushTransport` interface (`send(token, payload): Promise<void>`). Web Push uses the `web-push` npm library + VAPID keys; FCM uses the v1 HTTP API + service-account JWT (no Firebase Admin SDK — direct REST call, ~80 LOC, keeps the dependency surface flat).
- **NEW** REST routes in `packages/server/src/routes/push-routes.ts`:
  - `POST /api/push/register` — body `{deviceToken, transport, sessionFilter?}` → 200 with `{registered: true}`. Auth-gated via the existing `auth-plugin.ts` chain.
  - `DELETE /api/push/register/:tokenId` — unregister a device.
  - `POST /api/push/test` — send a test push to one or all of the caller's devices. Returns delivery receipt per token.
  - `GET /api/push/vapid-public-key` — returns the VAPID public key for Web Push subscription (server generates the keypair once on first start, stores in `~/.pi/dashboard/push-vapid.json`).
- **NEW** config block in `~/.pi/dashboard/config.json` schema (`packages/shared/src/config.ts`):
  ```ts
  push?: {
    enabled: boolean;             // default false (must be opted in)
    coalesceWindowMs: number;     // default 30_000, range 5_000–300_000
    fcm?: {
      serviceAccountPath: string; // path to Firebase service-account JSON
    };
    webPush?: {
      contactEmail: string;       // required by VAPID spec for `mailto:` subject
    };
  }
  ```
  Validator with clamping in the same shape as `parseOpenSpecPollConfig`.
- **MODIFY** `packages/server/src/event-wiring.ts` at the existing `isUnreadTrigger` site (`event-wiring.ts:188-201`) — add **one line** that calls `pushDispatcher.fanout(sessionId, event)` after the unread broadcast. Identical guard conditions: only live (non-replay) events, only when `!viewedSessionTracker.isViewedByAnyone(sessionId)`. Push and unread-stripes share the same gating.
- **NEW** `packages/client/src/hooks/usePushSubscription.ts` — Web Push registration: feature-detect `'serviceWorker' in navigator && 'PushManager' in window`, fetch VAPID public key, call `swReg.pushManager.subscribe(...)`, POST the subscription to `/api/push/register`. Idempotent — checks for existing subscription on mount.
- **MODIFY** `public/sw.js` — add a `'push'` event listener that parses the JSON payload and calls `self.registration.showNotification(...)` with click handler routing back to `/session/:id`.
- **NEW** Settings UI section `packages/client/src/components/PushNotificationsSection.tsx` — toggle to enable/disable push for the current device, list of registered devices with last-used timestamp, "Send test" button, "Unregister this device" button. Mounted under Settings → Notifications (new sub-page or top-level section — TBD in design.md).
- **NEW** repo-level lint test `packages/server/src/__tests__/push-dispatcher-fire-and-forget.test.ts` — fails the build if `push-dispatcher.fanout(...)` is ever `await`ed at the call site in `event-wiring.ts`. Push must be fire-and-forget; awaiting it would couple FCM/APNs latency to the event pipeline.
- **DOCUMENTATION** — update `docs/architecture.md` with a new "Push notifications" section covering: the trigger contract (same as unread-stripes), the coalescing rule, the per-token persistence shape, and the FCM service-account setup steps (Firebase project → service account → download JSON → reference in config). Add a one-line entry for each new file in `AGENTS.md`'s Key Files table.

## Capabilities

### New Capabilities

- `push-notifications` — server-side fan-out of agent-trigger events (`streaming→idle`, `ask_user`, `agent_end`-error) to registered devices via Web Push and/or FCM, with per-(session,device) coalescing, opt-in config, and a REST API for device registration/test/unregister.

### Modified Capabilities

- `event-wiring` — extends the existing `isUnreadTrigger` call site with a single fire-and-forget call into the push dispatcher. Same gating (no replay, no viewed sessions), same trigger predicate. Adds a new optional dependency (`pushDispatcher?: PushDispatcher`) to `EventWiringDeps` so existing tests that don't need it stay lean (mirrors the `viewedSessionTracker?` pattern).

## Out of Scope

- **Capacitor / native APK / iOS .ipa packaging** — covered by the follow-on change `add-capacitor-mobile-shell`. This change makes Capacitor's job trivial (just plug the FCM token into `/api/push/register`) but does not require Capacitor to ship.
- **Per-event-type push opt-in** (e.g. "push me on `ask_user` but not on `agent_end`-error"). v1 ships all-or-nothing per device. Granularity can be added via `sessionFilter` extension in a follow-up if real demand surfaces.
- **Quiet hours / DND scheduling** — out of scope; OS-level Do Not Disturb is the right layer for this.
- **Push payload encryption at rest** — Web Push is end-to-end encrypted by spec. FCM payloads are TLS to Google then to device — fine for v1. No HIPAA/PII data is in the payload (just session id + status + truncated message).
- **Rate limiting at the REST layer** — `/api/push/test` is auth-gated; the existing auth chain plus the in-pipeline 30s coalescing is sufficient for v1.
- **Multi-user push routing** — the `userId` field is recorded on the token but v1 fans out to *every* registered token (single-user dashboard assumption). Multi-user filtering is a follow-up.
