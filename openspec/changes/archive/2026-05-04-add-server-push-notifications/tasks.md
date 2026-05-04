# Tasks

## 1. Preconditions

- [x] 1.1 Read `packages/server/src/event-wiring.ts` — confirm evaluation site for co-locating separate `isPushTrigger` and `isUnreadTrigger` blocks.
- [x] 1.2 Read `packages/server/src/event-status-extraction.ts:209` (`isUnreadTrigger`) and `packages/server/src/viewed-session-tracker.ts` — confirm trigger/gating semantics.
- [x] 1.3 Read `packages/shared/src/config.ts::parseOpenSpecPollConfig` — confirm validator/clamping pattern.
- [x] 1.4 Read `packages/server/src/json-store.ts` — confirm atomic-write API.
- [x] 1.5 Read `packages/server/src/auth-plugin.ts` — confirm route auth chain.
- [x] 1.6 Read `packages/server/src/routes/system-routes.ts:190-205` — confirm `/api/health` response shape for adding `push.errors`.
- [x] 1.7 Run `npm test 2>&1 | tee /tmp/push-baseline.log`.

## 2. Push trigger predicate

- [x] 2.1 Add `isPushTrigger(eventType, before, after, payload): boolean` to `packages/server/src/event-status-extraction.ts`. Matches `ask_user` **transition** (currentTool changes TO "ask_user" from non-"ask_user") and `agent_end` with truthy error. Does NOT match `streaming→idle`.
- [x] 2.2 Unit tests in `packages/server/src/__tests__/push-trigger.test.ts`: ask_user transition fires, agent_end-error fires, streaming→idle does NOT fire, repeated ask_user while already "ask_user" does NOT fire (transition-based).

## 3. Config schema

- [x] 3.1 Extend `DashboardConfig` with `push?: {enabled: boolean, coalesceWindowMs: number, webPush?: {contactEmail: string}, errors?: string[]}`. Normalize: no block → `{enabled: false}`.
- [x] 3.2 `parsePushConfig(raw)`: clamp `coalesceWindowMs` 5_000–300_000 (default 30_000). When `enabled: true` and no `contactEmail` → set `errors: ["missing contactEmail"]`.
- [x] 3.3 Wire into `loadConfig()`. When `push.errors` is non-empty → `/api/health` includes `push: {errors}`. Transport disabled.
- [x] 3.4 Unit tests in `packages/shared/src/__tests__/config-push.test.ts`.

## 4. Token registry

- [x] 4.1 Create `packages/server/src/push/push-token-registry.ts`. Token: `{id, deviceToken: {endpoint, keys: {p256dh, auth}}, transport: string, userId?, registeredAt, lastUsedAt}`. Uniqueness by `deviceToken.endpoint`. Persist to `~/.pi/dashboard/push-tokens.json` with `0600` via `json-store.ts`.
- [x] 4.2 `createPushTokenRegistry({path})` returning `{add(token), remove(id), list(), findByEndpoint(endpoint), touch(id)}`.
- [x] 4.3 On `add`: validate `deviceToken.endpoint` is HTTPS URL, `keys.p256dh`/`keys.auth` are non-empty base64url strings. Reject malformed with Error.
- [x] 4.4 Unit tests: add/remove/list, persistence round-trip, idempotent, HTTPS-only, key length validation, transport rejection, 0600 permissions.
- [x] 4.5 Extend `json-store.ts` `writeJsonFile` with optional `{mode?: number}` parameter. Use for push tokens and VAPID keys to ensure `0600`. Chmod existing files on first write if permissions too open.

## 5. Push transport

- [x] 5.1 `packages/server/src/push/push-transports/types.ts`: `interface PushTransport { kind: string; send(token: PushToken, payload: PushPayload, opts?: {signal?: AbortSignal}): Promise<{ok: boolean; gone?: boolean}> }`.
- [x] 5.2 Add `web-push` to `packages/server/package.json`.
- [x] 5.3 `packages/server/src/push/push-transports/web-push.ts`: `createWebPushTransport({vapidKeys, contactEmail})` → `PushTransport`. Respect `opts.signal` for request cancellation. 410 → `{ok: false, gone: true}`.
- [x] 5.4 `packages/server/src/push/push-vapid.ts`: `loadOrGenerateVapidKeys(path): {publicKey, privateKey}`. Persist with `0600`.
- [x] 5.5 Unit tests for vapid persistence (permissions), web-push encoding, abort signal propagation.

## 6. Dispatcher

- [x] 6.1 `packages/server/src/push/push-dispatcher.ts`: `createPushDispatcher({transports: Map<string, PushTransport>, registry, coalesceWindowMs})`.
- [x] 6.2 `fanout(sessionId, sessionAfter, event): void` — wrapped in `try/catch`, coalescing applied, routes by `token.transport`, skips unknown transports with warning. Launches async work with attached `.catch(log)` — transport rejections resolve to `{tokenId, ok: false}` rather than rejecting.
- [x] 6.3 `sendNow(payload, opts?: {tokenIds?: string[]}): Promise<SendResult[]>` — bypasses coalescing, targets specific tokens when `opts.tokenIds` provided. Used by `/api/push/test` (`sendNow(payload, {tokenIds: [tokenId]})`) and `/api/push/send` (`sendNow(payload)` to all).
- [x] 6.4 In-memory coalescing map with lazy expiry. Per-send 10s timeout enforced at dispatcher level via `Promise.race`. Transport interface passes `AbortSignal` as best-effort cancellation.
- [x] 6.5 `buildPushPayload(session, event)` pure helper in `packages/server/src/push/build-push-payload.ts`.
- [x] 6.6 On `{ok: false, gone: true}` → `registry.remove(tokenId)`. On `ok: true` → `registry.touch(tokenId)`.
- [x] 6.7 Unit tests: trigger-to-payload, coalescing, dead-token pruning, fan-out non-throwing, sync registry/payload errors caught, async rejections caught via .catch, timeout, unknown transport skipped, sendNow vs fanout.

## 7. Wire into event pipeline

- [x] 7.1 Add `pushDispatcher?: PushDispatcher` to `EventWiringDeps`.
- [x] 7.2 Add separate `if (isPushTrigger(...) && !viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000}) && !replay)` block co-located with existing `isUnreadTrigger` block. Inside: `pushDispatcher?.fanout(sessionId, sessionAfter, event)`.
- [x] 7.3 Update `packages/server/src/server.ts` to construct dispatcher only when `push.enabled === true` AND `push.errors` is empty. When `push.errors` non-empty → mount `/api/push/*` with `503` middleware, surface in `/api/health`.
- [x] 7.4 Add `staleMs` option to `viewedSessionTracker.isViewedByAnyone`.
- [x] 7.5 Lint test `packages/server/src/__tests__/push-dispatcher-fire-and-forget.test.ts`: AST-scan for `await pushDispatcher`.
- [x] 7.6 Integration test: `agent_end` error → dispatcher called; `streaming→idle` → dispatcher NOT called; latency unaffected when transport hangs.

## 8. REST routes

- [x] 8.1 `packages/server/src/routes/push-routes.ts` — 6 endpoints with per-endpoint rate limits:
  - `POST /api/push/register` — `{deviceToken: PushSubscriptionJSON, transport?}` → `200 {tokenId, registered: true}`. 10/min. Default transport to `"web-push"`, reject non-`"web-push"` with `400`. Validate endpoint HTTPS + key lengths (p256dh→65 bytes, auth→16 bytes) → 400.
  - `DELETE /api/push/register/:tokenId` → `204`. 10/min.
  - `GET /api/push/tokens` → `200 {tokens: [{id, transport, endpointLast4, registeredAt, lastUsedAt}]}`. 30/min.
  - `POST /api/push/test` → `200 {results: [{tokenId, ok, gone?}]}`. 5/min. Uses `sendNow(payload, {tokenIds: tokenId ? [tokenId] : undefined})`.
  - `POST /api/push/send` → body `{title: ≤200, body: ≤500, url?: "/..."}` → `200 {results: [{tokenId, ok, gone?}]}`. 2/min. Uses `sendNow(payload)` to all. URL: reject `//`, `\\`, encoded protocols; validate `new URL(url, origin).origin === origin`. Audit-log.
  - `GET /api/push/vapid-public-key` → `200 {publicKey}`. 30/min.
- [x] 8.2 Auth-gated via existing auth-plugin chain. Add `Authorization: Bearer <auth.secret>` validation to auth-plugin before cookie/JWT check. Skill auth: read `auth.secret` from config, pass as Bearer header, works on loopback and remote.
- [x] 8.3 Unit tests: register with non-HTTPS endpoint → 400, malformed keys → 400, send with `//evil.com` → 400, oversized → 400, rate limit → 429, tokens list shape (no keys), test/send endpoints use sendNow.

## 9. `/api/health` push integration

- [x] 9.1 Add `push?: {errors: string[]}` to health response in `packages/server/src/routes/system-routes.ts` (present when `push.enabled: true` and errors non-empty).
- [x] 9.2 Test: health endpoint includes `push.errors` when contactEmail missing.

## 10. Service worker + tests

- [x] 10.1 Update `public/sw.js` — push handler with try/catch, null-data fallback. Click handler with exact pathname matching.
- [x] 10.2 Bump SW version comment.
- [x] 10.3 `packages/client/src/__tests__/sw-push.test.ts` — 7 tests: valid JSON, malformed JSON, empty push, click with URL, click without URL, click focuses existing window (exact pathname match), non-secure context.

## 11. Client subscription hook + Settings UI

- [x] 11.1 `packages/client/src/hooks/usePushSubscription.ts`: `{supported, status, subscribe(), unsubscribe(), sendTest()}`.
- [x] 11.2 `subscribe()`: request permission → `GET /api/push/vapid-public-key` → base64url-decode to `Uint8Array` → `swReg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` → `POST /api/push/register` → store `tokenId`.
- [x] 11.3 On mount: reconcile — check existing `swReg.pushManager.getSubscription()`, if present POST to `/api/push/register`, store `tokenId`.
- [x] 11.4 `unsubscribe()`: `PushSubscription.unsubscribe()` AND `DELETE /api/push/register/:tokenId`.
- [x] 11.5 `supported: false` when not in secure context or `PushManager` unavailable.
- [x] 11.6 `packages/client/src/components/PushNotificationsSection.tsx` — status, subscribe/unsubscribe, device list (via `GET /api/push/tokens`), Send Test, Unregister, iOS hint.
- [x] 11.7 Component tests for all UI states. (17 tests — unsupported, available, subscribed, denied, iOS hint)

## 12. Push-notify-user skill

- [x] 12.1 `.pi/skills/push-notify-user/SKILL.md` — teaches agent to call `POST /api/push/send`.
- [x] 12.2 Auth: read `auth.secret` from `~/.pi/dashboard/config.json`, pass as `Authorization: Bearer <secret>`. Works via loopback bypass.
- [x] 12.3 Auto-detect dashboard URL from running server.
- [x] 12.4 Handle: unreachable, 401, 404, 200-empty-results, 429.

## 13. Documentation

- [x] 13.1 `docs/architecture.md` — "Push notifications" section: `isPushTrigger` vs `isUnreadTrigger`, stale-view TTL, coalescing, token shape, VAPID setup, safety guards, skill auth model.
- [x] 13.2 New rows in `AGENTS.md` Key Files.
- [x] 13.3 New row in `README.md` for `push.*` config keys.

## 14. Verification

- [x] 14.1 `npm test` green; no unrelated regressions. (5 pre-existing failures unchanged, +77 new tests all pass)
- [x] 14.2 Manual: enable push, Chrome subscription (with VAPID key), `ask_user` → notification.
- [x] 14.3 Manual: Firefox (Mozilla autopush).
- [x] 14.4 Manual: iOS PWA (Safari 16+, home screen).
- [x] 14.5 Manual: `streaming→idle` does NOT push.
- [x] 14.6 Manual: 5 rapid `ask_user` → 1 push (coalescing).
- [x] 14.7 Manual: background tab open → push fires after 60s (stale-view TTL).
- [x] 14.8 Manual: agent uses `push-notify-user` skill → push arrives.
- [x] 14.9 Manual: `/api/push/send` rate limited → 429.
- [x] 14.10 Manual: `/api/push/send` with `//evil.com` → 400.
- [x] 14.11 Manual: `/api/push/register` with http endpoint → 400.
- [x] 14.12 Manual: `GET /api/push/tokens` returns safe metadata.
- [x] 14.13 Manual: missing contactEmail → `/api/health` includes `push.errors`.
- [x] 14.14 Manual: `push-vapid.json` and `push-tokens.json` have `0600` permissions.
- [x] 14.15 `openspec validate add-server-push-notifications --strict`.
