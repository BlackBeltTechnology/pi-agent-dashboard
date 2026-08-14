# Tasks — replay-invoice-domain-events

## 1. Cache module (TDD)

- [x] 1.1 Write `packages/server/src/__tests__/ib-domain-event-cache.test.ts` first
  (RED): latest-per-key retention, distinct-invoice independence, key derivation
  (`invoice_id` from `event.data`, fallback to `id`/`connector_id`/`which`/bare
  eventType), `MAX_ENTRIES` eviction of oldest, `clearForSession` purge,
  malformed-frame no-op.
- [x] 1.2 Add `packages/server/src/ib-domain-event-cache.ts`: `IbDomainEventCache`
  class (`set(frame)`, `getAll()`, `clearForSession(sessionId)`, `reset()`) +
  module singleton `ibDomainEventCache`. Insertion-ordered `Map`; delete-then-set
  to refresh recency; hard cap eviction. Mirror `plugin-intent-cache.ts` shape.
- [x] 1.3 Green 1.1.

## 2. Wire caching + observability at the broadcast choke point

- [x] 2.1 In `packages/server/src/server.ts` `broadcastToSubscribers` interceptor
  (≈:1877, beside the `plugin_intents` interception): when
  `m.type === "ib_domain_event"`, `ibDomainEventCache.set(m)` guarded (never throw).
- [x] 2.2 Add a rate-limited (1/50) info log at the same point naming
  `event.eventType` + derived entity id.
- [x] 2.3 Wire `ibDomainEventCache.clearForSession(...)` to the same session-removal
  path that clears `pluginIntentCache` (find the existing `clearForSession` call
  site; add the sibling call).

## 3. Protocol field

- [x] 3.1 In `packages/shared/src/browser-protocol.ts`, add optional
  `replay?: boolean` to `IbDomainEventMessage` with a doc comment (absent/false =
  live, true = replayed idempotent state-set).

## 4. Replay on connect (TDD)

- [x] 4.1 Write a server integration test (RED): connect a browser AFTER an
  `ib_domain_event` was broadcast; assert the browser receives the cached frame
  with `replay: true`; assert a live event broadcast afterwards arrives without
  `replay`. Mirror `ib-app-level-rebroadcast.test.ts` harness
  (`packages/invoicebot-plugin/src/server/__tests__/`) or a `packages/server`
  gateway test — whichever runs without the plugin dispatch surface.
- [x] 4.2 In `packages/server/src/pairing/browser-gateway.ts` on-connect snapshot
  block (beside `sessions_snapshot` / `pinned_dirs_updated`): for each
  `ibDomainEventCache.getAll()` entry, `sendTo(ws, { ...frame, replay: true })`.
- [x] 4.3 Green 4.1.

## 5. Gate (e2e OFF — do NOT run the faux e2e suite)

- [x] 5.1 `npx tsc -p tsconfig.typecheck.json` (or the repo's typecheck) clean for
  touched packages.
- [x] 5.2 Scoped unit tests green: the new cache test, the connect-replay test, and
  the existing `ib-app-level-rebroadcast` regression.
- [x] 5.3 `npm run build` (Vite client) succeeds.
- [x] 5.4 Verify no automation-plugin / invoicebot-plugin dispatch/fan-out file was
  touched (`git diff --name-only`).

## 6. Manual / QA (verified post-merge on the operator's instance)

- [ ] 6.1 A board surface that mounts after a state change converges via the
  `replay: true` frame (front-end board poll is a separate safety net, not assumed).
