# Replay invoice domain events on connect

## Why

The app-level `ib_domain_event` channel is **live-delta only**. The plugin
server rebroadcasts each `ib:*` lifecycle event to every connected browser
(`packages/invoicebot-plugin/src/server/index.ts` →
`ctx.broadcastToSubscribers`), and the core fan-out
(`packages/server/src/server.ts:1877` → `browserGateway.broadcast`) sends it to
all sockets **with no server-side cache**. Any surface that mounts, re-fetches,
or reconnects *after* an event was broadcast has missed that delta forever and
never reconciles — it waits for the next accidental delta. This is the honest,
dashboard-owned cause behind the stale board/waiting-file strip: a fetch-on-mount
surface has no way to converge on current truth.

The dashboard already solved this exact shape for **plugin intents**: the same
`broadcastToSubscribers` choke point intercepts `plugin_intents` frames and caches
the latest per `(pluginId, sessionId, slot)`
(`packages/server/src/plugin-intent-cache.ts`), then replays them to a
(re)connecting/subscribing browser (`replayUiState` in
`browser-handlers/subscription-handler.ts`). `ib_domain_event` has no equivalent.

This change gives `ib_domain_event` the same recoverability: a bounded
**latest-per-invoice** cache, replayed to each browser on connect and marked so
consumers cannot double-apply it.

## What changes

- **New** `packages/server/src/ib-domain-event-cache.ts` — a bounded module
  singleton retaining the **latest** `ib_domain_event` frame per key.
- **Modify** the `broadcastToSubscribers` interceptor at
  `packages/server/src/server.ts:1877` to `cache.set(...)` every `ib_domain_event`
  it fans out (mirroring the adjacent `plugin_intents` interception) and to emit a
  **rate-limited success log** so the next incident is not misdiagnosed as "zero
  events" (the prior investigation's zero log-count was a logging artifact of an
  unlogged happy path).
- **Modify** the browser on-connect snapshot block in
  `packages/server/src/pairing/browser-gateway.ts` to replay every cached
  `ib_domain_event`, each stamped `replay: true`.
- **Modify** `IbDomainEventMessage` in
  `packages/shared/src/browser-protocol.ts` to add an optional `replay?: boolean`
  discriminator (absent/false on live frames, `true` on replayed frames).
- **Do not** touch the forward path (proved correct) nor
  automation-plugin / invoicebot-plugin dispatch/fan-out (owned elsewhere).

Out of scope: the front-end board poll being added as an independent safety net —
this change does not assume it and is not a substitute for it.

## Impact

- Affected spec: `invoicebot-app-level-events` (one requirement MODIFIED — the
  delta-only/no-replay guarantee is relaxed to latest-state convergence replay;
  one requirement ADDED for the cache + replay marker).
- Affected code: `packages/server` (new cache + two edits), `packages/shared`
  (one optional field). No engine, no plugin bridge, no dispatch/fan-out.
- Backward compatible wire: live frames keep the exact
  `{ type, sessionId, event }` shape (`replay` absent); only replayed frames add
  `replay: true`.

## Discipline Skills

- `review-code` — non-trivial server change with a new shared module and a
  protocol field; run the inline review→fix loop before commit.
- `performance-optimization` is **not** triggered: the cache is O(1) set + a
  bounded connect-time replay; no measured latency budget is in play.
- No auth/untrusted-input/secrets/PII surface is touched, so
  `security-hardening` and `observability-instrumentation` beyond the single
  success log do not apply.
