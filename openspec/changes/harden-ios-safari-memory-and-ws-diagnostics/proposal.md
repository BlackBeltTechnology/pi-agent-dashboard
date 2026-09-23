## Why

Issue #712 reports iOS Safari reloading the whole dashboard page while a session opens or a turn streams. The client never reloads itself, and every browser WebSocket drop in the report is close code `1006`. Taken together, this fits WebKit killing the tab's WebContent process under memory pressure. Two gaps matter here:

1. On `develop`, the landing document still `modulepreload`s the full `@mdi/js` icon set (`mdi-*.js`, ~2.78 MB raw). Two things cause it: a `manualChunks` entry that turns the whole set into one entry-reachable chunk, and three resolvers that look icons up by a runtime key string (`import * as mdi`), which defeats tree-shaking. The existing build guard only inspects the entry script, so it never caught this. Every cold load parses and keeps that chunk.
2. The server can't diagnose this class of bug. The browser gateway logs no close code, reason or lifetime, and it has no keepalive. A rejected `/ws` upgrade (401/403) destroys the socket without logging anything, so tunnel-induced WS rejections can't be seen.

Out of scope because it is already done: the transcript is already virtualized (`ChatView.tsx` `useVirtualizer`, shipped in 0.8.0; the issue's grep of the minified bundle missed it). `xterm`/`diff` were taken out of the cold landing by #694 (unreleased at 0.8.0).

## What Changes

- **Lazy full icon set.** Icon-by-key lookup (extension-UI icons, `ActionList`, `StatusPill`) loads the full MDI icon set on demand, the first time a key is resolved. The landing document no longer references the full-icon-set chunk. Named icon imports across the shell stay static and tree-shaken.
- **Browser WS close diagnostics.** On every browser socket close, the gateway logs one line with the close code, reason, connection lifetime, inbound frame count, and cause (peer / keepalive / stalled).
- **Browser WS keepalive.** The gateway pings browser sockets on a fixed interval and terminates a socket that leaves two consecutive pings unanswered.
- **Rejected-upgrade diagnostics.** The WS upgrade rejections that are silent today (bridge-scope 400, auth 401, no-auth 403) log a rate-limited line with scope, peer address, the forwarding-header *names* present, and whether a ticket was present. Header values, cookies and ticket values are never logged. Rejections already logged by `[host-gate]` / `[ws-gate]` are unchanged.
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
- Client-utils (published, consumed by plugins): new `packages/client-utils/src/mdi-by-key.ts` + `./mdi-by-key` subpath in `packages/client-utils/package.json` `exports`; `packages/client-utils/src/{ActionList,StatusPill}.tsx`. The public props don't change; an icon may now paint one tick after the first mount.
- Server: `packages/server/src/pairing/browser-gateway.ts` (close line, keepalive timer cleared on `wss` close), new `packages/server/src/auth/ws-upgrade-reject-log.ts`, `packages/server/src/auth/localhost-guard.ts` (export forwarding-header names helper), `packages/server/src/server.ts` (three silent rejection branches + logger instance).
- Client also: `components/extension-ui/FooterSegmentSlot.tsx` gets a per-segment component (a hook cannot run in `.map`); `src/__tests__/extension-ui-modal.test.tsx` preloads the icon set before its sync `resolveMdiIcon` assertions.
- No protocol, persistence or config changes, so no migration. Rollback means reverting the commit.
