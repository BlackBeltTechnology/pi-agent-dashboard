## Why

The dashboard already decides server-side when a session needs the user. `isUnreadTrigger(eventType, before, after, payload)` (`packages/server/src/session/event-status-extraction.ts:263`) fires when:
- an agent finishes a turn (`streaming → idle/active`);
- an agent waits for input (`currentTool → "ask_user"`);
- an agent crashes (`agent_end` with a truthy error).

Its one consumer, `stampUnreadIfTriggered` (`packages/server/src/event-wiring.ts:662`), flips a per-session `unread` bit and broadcasts `session_updated` to **connected** browsers. Disconnected, backgrounded or mobile users learn nothing.

Push closes that gap. Hooking a fan-out dispatcher into the existing unread trigger gives cross-device awareness with **zero new event semantics** and one new line at the call site.

v1 reaches the existing PWA through W3C Web Push (Chrome, Edge, Firefox, Safari 16.4+ on iOS). It also reaches any HTTP receiver through a generic webhook transport, such as a self-hosted agent like nanoMuse, ntfy or Home Assistant. The follow-on `add-capacitor-mobile-shell` reuses the same endpoints through FCM.

## What Changes

- **NEW** `packages/server/src/push/`:
  - `push-token-registry.ts`: in-memory registry of `{id, deviceToken, transport: "web-push"|"fcm"|"webhook", label?, userId?, sessionFilter?, registeredAt, lastUsedAt}`. Write-through to `~/.pi/dashboard/push-tokens.json` (mode `0600`). Idempotent by `deviceToken`.
  - `push-dispatcher.ts`: `fanout(sessionId, {eventType, after, payload, unreadEdge})` returns `void`, never throws or rejects, and does no synchronous I/O. Cadence is hybrid: device tokens (`web-push`, `fcm`) only on the unread `false → true` edge; webhook tokens on every qualifying trigger. Webhook deliveries are coalesced to at most one per `(sessionId, tokenId)` per window; device tokens are rate-limited by the unread edge alone. Prunes gone tokens.
  - `build-push-payload.ts`: pure helper that builds `PushPayload`.
  - `push-vapid.ts`: VAPID keypair generated once, persisted `0600`.
  - `push-transports/{types,web-push,fcm,webhook}.ts`: one `PushTransport` interface.
    - Web Push uses the `web-push` library.
    - FCM uses the v1 HTTP API with a service-account JWT and no Firebase SDK.
    - Webhook POSTs JSON to a registered `http(s)` URL via `undici`. Link-local and metadata addresses, and the dashboard's own port on a local address, are refused on every resolved IP, and the connection is pinned to the vetted address. Redirects are not followed, delivery times out after 5 s, and the URL is redacted to label plus origin in every response and log line. Only `410` prunes a webhook token; `404` counts as a failure.
- **NEW** REST routes in `packages/server/src/routes/push-routes.ts`. They are always registered and answer `404` while push is disabled:
  - `POST /api/push/register`, body `{deviceToken, transport, label?, sessionFilter?}` → `200 {tokenId}`.
  - `GET /api/push/register` → `200 {tokens: [{tokenId, transport, display, registeredAt, lastUsedAt, consecutiveFailures}]}`. `display` is label plus origin for webhooks, or a device hint otherwise.
  - `DELETE /api/push/register/:tokenId` → `204`.
  - `POST /api/push/test`, body `{tokenId?}` → `200 {results: [{tokenId, ok, gone?}]}`.
  - `GET /api/push/vapid-public-key` → `200 {publicKey}`.
- **MODIFY** `packages/shared/src/route-tiers.ts`: `GET /api/push/vapid-public-key` is `observe`; every other push route is `operate`. **MODIFY** `packages/mcp-server-plugin/src/server/tools.denylist.ts`: the push routes are not exposed as MCP tools.
- **NEW** config block in `packages/shared/src/config.ts`, with a validator that clamps values. A missing or partial block parses as disabled:
  ```ts
  push?: {
    enabled: boolean;             // default false
    coalesceWindowMs: number;     // default 30_000, clamped 5_000–300_000
    fcm?: { serviceAccountPath: string };
    webPush?: { contactEmail: string };  // VAPID `mailto:` subject
  }
  ```
- **MODIFY** `packages/server/src/persistence/json-store.ts`: `writeJsonFile` gains an optional `{ mode }`. With it set, the `.tmp` file is `chmod`ed unconditionally before the rename.
- **MODIFY** `/api/health`: add `push.errors`, disclosed only when `canDiscloseAccessPosture(request)` holds. The health-shape tests are updated.
- **NEW** dependencies: `web-push` and `undici` in `packages/server/package.json`.
- **MODIFY** `packages/server/src/event-wiring.ts`: add `pushDispatcher?` to `EventWiringDeps`. In `stampUnreadIfTriggered`, capture `unreadEdge = !!session && !session.unread` and, when the session exists, call `pushDispatcher?.fanout(sessionId, {eventType, after, payload, unreadEdge})` after the unread block. It runs on every qualifying trigger, and the dispatcher applies the hybrid cadence. The `event_forward` and `prompt_request` callers can both hit one `ask_user` edge; the unread edge absorbs that for devices and coalescing absorbs it for webhooks.
- **MODIFY** `packages/server/src/server.ts`: build the dispatcher only when `config.push.enabled === true`, and pass it to `wireEvents`.
- **NEW** `packages/client/src/hooks/usePushSubscription.ts`: Web Push registration. It feature-detects support, fetches the VAPID key, calls `pushManager.subscribe`, and POSTs `/api/push/register`. Idempotent.
- **MODIFY** repo-root `public/sw.js`: add `push` and `notificationclick` listeners. A click focuses an existing dashboard window and navigates it to `payload.url`, or opens a new one.
- **NEW** `packages/client/src/components/settings/PushNotificationsSection.tsx`, mounted in `SettingsPanel.tsx`. It includes:
  - an enable/disable toggle for this device;
  - the list of registered tokens (display only), each with unregister and Send Test;
  - an **"Add webhook URL"** field with an optional label;
  - an iOS "install to home screen first" hint;
  - a "Web Push needs https or localhost" notice when the page is not a secure context, pointing at the webhook option.

## Capabilities

### New Capabilities

- `push-notifications`: server-side fan-out of the unread trigger (turn finished, `ask_user`, crash) to registered tokens, with a hybrid cadence (devices on the unread edge, webhooks per trigger), via Web Push, FCM and/or generic webhook. Includes per-(session, token) coalescing, opt-in config, a REST API to register, list, test and unregister tokens, and a Settings UI.
- `event-wiring`: the unread-trigger site in `stampUnreadIfTriggered` becomes the single push hook, passing `unreadEdge`, with an optional `pushDispatcher` dependency.

## Out of Scope

- **Capacitor / native packaging**: covered by the follow-on `add-capacitor-mobile-shell`.
- **Per-event-type opt-in** ("push on `ask_user` but not on crash"). v1 is all-or-nothing per token. `sessionFilter` limits a token to exact session ids; absent or empty means all sessions.
- **Changing the viewed gating**: a hidden tab that still has the session selected suppresses push. This is inherited from `viewed-session-unread-gating`.
- **Quiet hours / DND**: the OS layer handles this.
- **Per-webhook custom headers and delivery retries**: v1 webhook auth rides in the URL (nanoMuse `?key=`, ntfy `?auth=`). `429`, `5xx` and timeouts are logged, not retried.
- **Multi-user push routing**: `userId` is recorded, but v1 fans out to every registered token (single-user assumption, see design Risks).
- **MCP tools for push management**: the routes are denylisted in the MCP manifest for v1.

## Discipline Skills

- `security-hardening`: the webhook transport makes the server POST to a user-supplied URL whose query carries a secret. Covered by: scheme allowlist, a link-local/metadata block on the resolved IP with a pinned connection, no redirect following, a bounded timeout, URL redaction in responses and logs, an opaque test endpoint, and `0600` for the token and VAPID files.
- `observability-instrumentation`: new outbound calls (webhook, Web Push, FCM). Each delivery logs one structured line with transport, redacted target, outcome and latency. Configuration failures surface in `/api/health` as `push.errors`.
- `doubt-driven-review`: done during planning (two cycles, two reviewers each, one cross-model). The fixes are folded into design Decisions 4 and 6–12.
