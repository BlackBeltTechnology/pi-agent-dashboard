## Why

The dashboard already has a server-side classifier — `isUnreadTrigger(eventType, before, after, payload)` in `packages/server/src/event-status-extraction.ts:209` — that detects when an agent waits for input (`currentTool → "ask_user"`) or crashes (`agent_end` with truthy error). Today this classifier flips a per-session `unread` bit and broadcasts `session_updated` to *connected* browsers (see `event-wiring.ts:181-201`). Disconnected, backgrounded, or mobile users learn nothing.

Push notifications close that gap for the two events that genuinely require user attention: `ask_user` (agent needs input) and `agent_end` error (agent crashed). A dedicated `isPushTrigger` predicate — distinct from `isUnreadTrigger` — ensures only these two events trigger pushes. Routine turn completion (`streaming→idle`) is deliberately excluded: without a "read" concept in the dashboard, auto-pushing every turn would spam users. Unread stripes are ephemeral; push notifications are disruptive and persist in the OS notification center.

This change ships value to the existing PWA via the W3C Web Push spec (Chrome / Edge / Firefox / Safari 16+ on iOS). No native app required.

## What Changes

- **NEW** `packages/server/src/push/` module with three files:
  - `push-token-registry.ts` — persists push tokens to `~/.pi/dashboard/push-tokens.json` with `0600` permissions via atomic write. Each token: `{id, deviceToken: {endpoint, keys: {p256dh, auth}}, transport: "web-push", userId?, registeredAt, lastUsedAt}`. Uniqueness by `deviceToken.endpoint`. Validates HTTPS endpoint + non-empty keys on register.
  - `push-dispatcher.ts` — `fanout(sessionId, sessionAfter, event): void` for automatic triggers (coalescing, fire-and-forget). `sendNow(payload): Promise<SendResult[]>` for REST endpoints (no coalescing, per-token results). Accepts `transports: Map<string, PushTransport>`. Per-send 10s timeout via `AbortController` passed to transport.
  - `isPushTrigger(eventType, before, after, payload)` — pure function in `event-status-extraction.ts`. Matches `ask_user` **transition** and `agent_end` error. Distinct from `isUnreadTrigger`.
  - `push-transports/web-push.ts` — Web Push adapter implementing `PushTransport`. Interface: `kind: string` (extensible), `send(token, payload, opts?: {signal?: AbortSignal})`. Respects `signal` for request cancellation.
- **NEW** REST routes (6 endpoints, auth-gated, per-endpoint rate limits):
  - `POST /api/push/register` — body `{deviceToken: PushSubscriptionJSON, transport?}` → `200 {tokenId, registered: true}`. 10/min. Validates HTTPS endpoint + non-empty keys.
  - `DELETE /api/push/register/:tokenId` — unregister. 10/min.
  - `GET /api/push/tokens` — list devices with safe metadata: `{id, transport, endpointLast4, registeredAt, lastUsedAt}`. No full endpoint, no keys. 30/min.
  - `POST /api/push/test` — test push via `sendNow`. 5/min.
  - `POST /api/push/send` — agent push via `sendNow`. Body `{title: ≤200, body: ≤500, url?: "/..."}`. URL validated: single `/`, rejects `//`, same-origin check. 2/min. Audit-logged.
  - `GET /api/push/vapid-public-key` — VAPID public key. 30/min.
- **NEW** config block in `~/.pi/dashboard/config.json` schema (`packages/shared/src/config.ts`):
  ```ts
  push?: {
    enabled: boolean;             // default false (must be opted in)
    coalesceWindowMs: number;     // default 30_000, range 5_000–300_000
    webPush?: {
      contactEmail: string;       // required by VAPID spec for `mailto:` subject
    };
  }
  ```
  Validator with clamping in the same shape as `parseOpenSpecPollConfig`.
- **MODIFY** `packages/server/src/event-wiring.ts` — add `isPushTrigger` evaluation co-located with `isUnreadTrigger`. Gating: not replay AND `!viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})`. Stale-view TTL prevents background tabs and sleeping laptops from suppressing push indefinitely. One line: `pushDispatcher?.fanout(sessionId, sessionAfter, event)`.
- **NEW** `packages/client/src/hooks/usePushSubscription.ts` — `subscribe()` fetches VAPID public key, base64url-decodes to `Uint8Array`, calls `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`. On mount: reconcile existing subscription, POST to `/api/push/register`, store `tokenId`. `unsubscribe()`: both `PushSubscription.unsubscribe()` and `DELETE` server token.
- **MODIFY** `public/sw.js` — push/notificationclick handlers with fallbacks. Click handler uses exact pathname matching (`new URL(client.url).pathname === urlPath`), not substring `includes`, to avoid matching `/session/abc` against `/session/abcd`.
- **NEW** Settings UI section `packages/client/src/components/PushNotificationsSection.tsx` — status, subscribe/unsubscribe, list of registered devices (via `GET /api/push/tokens`), Send Test, Unregister. iOS hint when `iOS && !standalone`.
- **NEW** repo-level lint test `packages/server/src/__tests__/push-dispatcher-fire-and-forget.test.ts` — fails the build if `push-dispatcher.fanout(...)` is ever `await`ed at the call site in `event-wiring.ts`. Push must be fire-and-forget; awaiting it would couple push service latency to the event pipeline.
- **MODIFY** `packages/server/src/routes/system-routes.ts` — `/api/health` includes `push?: {errors: string[]}` when `push.enabled: true` and errors present (e.g. missing contactEmail).
- **NEW** `packages/client/src/__tests__/sw-push.test.ts` — 7 scenarios: valid JSON, malformed, empty, click with/without URL, focus existing window (exact pathname), non-secure context.
- **NEW** pi skill `.pi/skills/push-notify-user/SKILL.md` — agent calls `POST /api/push/send`. Auth via `Authorization: Bearer <auth.secret>` (loopback). Handles: unreachable, 401, 404, 200-empty, 429. **Also bundled with the bridge extension** (`packages/extension/.pi/skills/push-notify-user/`) so `pi install @blackbelt-technology/pi-dashboard-extension` auto-installs the skill.
- **DOCUMENTATION** — update `docs/architecture.md` with a new "Push notifications" section covering: the trigger contract (same as unread-stripes), the coalescing rule, the per-token persistence shape, and the Web Push setup (VAPID keypair generation, `contactEmail` requirement). Add a one-line entry for each new file in `AGENTS.md`'s Key Files table.

## Capabilities

### New Capabilities

- `push-notifications` — server-side fan-out of two agent-trigger events (`ask_user`, `agent_end`-error) to registered devices via Web Push, with per-(session,device) coalescing, opt-in config, a REST API for device registration/test/send, and a pi skill (`push-notify-user`) for on-demand push from agents. Routine turn completion (`streaming→idle`) is deliberately excluded — without a read/ack concept, auto-pushing every turn would spam users.

### Modified Capabilities

- `event-wiring` — adds `isPushTrigger` evaluation at the same site as `isUnreadTrigger`. Gating: not replay, viewed ≤60s stale TTL. `pushDispatcher` receives `sessionAfter` for payload building. Optional `PushDispatcher` in `EventWiringDeps`.

## Out of Scope

- **Capacitor / native APK / iOS .ipa packaging** — out of scope. This change focuses purely on the existing PWA via Web Push.
- **Per-event-type push opt-in** (e.g. "push me on `ask_user` but not on `agent_end`-error"). v1 ships all-or-nothing per device. Granularity can be added via `sessionFilter` extension in a follow-up if real demand surfaces.
- **Quiet hours / DND scheduling** — out of scope; OS-level Do Not Disturb is the right layer for this.
- **Push payload encryption at rest** — Web Push is end-to-end encrypted by spec. No HIPAA/PII data is in the payload (just session id + status + truncated message).
- **Rate limiting at the REST layer** — per-endpoint limits; `/api/push/send` enforces 2/min, validates url as single-leading-slash with same-origin check, caps title/body, audit-logs.
- **Multi-user push routing** — the `userId` field is recorded on the token but v1 fans out to *every* registered token (single-user dashboard assumption). Multi-user filtering is a follow-up.
