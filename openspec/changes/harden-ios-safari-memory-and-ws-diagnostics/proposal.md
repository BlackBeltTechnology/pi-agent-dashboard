## Why

Issue #712 reports iOS Safari reloading the whole dashboard page while a session opens or a turn streams. The client never reloads itself, and every browser WebSocket drop in the report is close code `1006`. Taken together, this fits WebKit killing the tab's WebContent process under memory pressure. Two gaps matter here:

1. On `develop`, the landing document still `modulepreload`s the full `@mdi/js` icon set (`mdi-*.js`, ~2.78 MB raw). The only reason is the resolvers that look icons up by a runtime key string. Every cold load parses and keeps that chunk.
2. The server can't diagnose this class of bug. The browser gateway logs no close code, reason or lifetime, and it has no keepalive. A rejected `/ws` upgrade (401/403) destroys the socket without logging anything, so tunnel-induced WS rejections can't be seen.

Out of scope because it is already done: the transcript is already virtualized (`ChatView.tsx` `useVirtualizer`, shipped in 0.8.0; the issue's grep of the minified bundle missed it). `xterm`/`diff` were taken out of the cold landing by #694 (unreleased at 0.8.0).

## What Changes

- **Lazy full icon set.** Icon-by-key lookup (extension-UI icons, `ActionList`, `StatusPill`) loads the full MDI icon set on demand, the first time a key is resolved. The landing document no longer references the full-icon-set chunk. Named icon imports across the shell stay static and tree-shaken.
- **Browser WS close diagnostics.** On every browser socket close, the gateway logs the close code, reason, connection lifetime and inbound frame count.
- **Browser WS keepalive.** The gateway pings browser sockets on a fixed interval and terminates a socket that misses consecutive pongs, logging why it terminated.
- **Rejected-upgrade diagnostics.** Every rejected WS upgrade (401/403/400) logs a rate-limited line with scope, peer address, the forwarding-header *names* present, and whether a ticket was present. Header values and ticket values are never logged.
- **Tool groups collapsed on mobile.** On mobile viewports a running tool group does not auto-expand; the user taps to open it. This caps DOM growth in the non-virtualized streaming tail. Desktop behaviour is unchanged.

## Capabilities

### New Capabilities
- `browser-ws-diagnostics`: close-code logging, keepalive/terminate, and rejected-upgrade logging for the browser-facing WebSocket path.

### Modified Capabilities
- `client-build-config`: the "@mdi/js is isolated from the eager entry chunk" requirement changes. The full icon set is now lazily loaded and absent from the landing document, instead of being an eager dedicated chunk.
- `mobile-resilience`: adds "Tool groups collapsed on mobile" (a running group does not auto-expand on mobile viewports).

## Discipline Skills

- `security-hardening`: the new upgrade-rejection log sits on an auth path. It must not leak ticket values, cookies or forwarding-header values, and rate-limiting must stop a rejected client from flooding the log.
- `performance-optimization`: the icon change is a measured load-cost change. Record `index.html` preload bytes before and after, and keep the result in a build guard.
- `observability-instrumentation`: the new close/keepalive/rejection lines are the whole point of the server half. They need a stable, grep-able format.
- `review-code`: before commit, per project doctrine.

## Impact

- Client: `packages/client/src/lib/preview/mdi-icon-lookup.ts`, `components/extension-ui/{GenericExtensionDialog,FooterSegmentSlot}.tsx`, `components/chat/ToolBurstGroup.tsx`, `packages/client/vite.config.ts` (`mdi` manualChunks entry), build guard `src/__tests__/mdi-chunk-size.test.ts`.
- Client-utils (published, consumed by plugins): `packages/client-utils/src/{ActionList,StatusPill}.tsx`. The public props don't change; an icon may now paint one tick after the first mount.
- Server: `packages/server/src/pairing/browser-gateway.ts` (close handler, keepalive timer + cleanup on `stop`), `packages/server/src/server.ts` (upgrade rejection branches).
- No protocol, persistence or config changes, so no migration. Rollback means reverting the commit.
