## Context

See proposal.md for motivation (issue #712). State of `develop` that shapes the approach:

- `dist/index.html` `modulepreload`s `react-vendor`, `util`, `markdown`, `mdi` (2,780,948 B raw), `jsdiff`, `dnd`. `xterm`/`diff` are already lazy (#694, `lazy-feature-preload.test.ts`).
- The full icon set is eager because three modules do `import * as mdi from "@mdi/js"` and look up keys at runtime: `packages/client/src/lib/preview/mdi-icon-lookup.ts` (`resolveMdiIcon`, used by `GenericExtensionDialog`, `FooterSegmentSlot`), `packages/client-utils/src/ActionList.tsx` and `packages/client-utils/src/StatusPill.tsx`. Around 150 other files import icons by name.
- `vite.config.ts` `manualChunks` maps every `/node_modules/@mdi/js/` module to the `mdi` chunk. Change `shrink-client-index-chunk` added this to get the set out of `index`, but a manual chunk is not a lazy boundary.
- `browser-gateway.ts` `ws.on("close", () => …)` ignores `(code, reason)` and has no ping timer. `pi-gateway.ts` has one (`WS_PING_INTERVAL`, injectable `pingInterval`).
- `server.ts` upgrade handler: the bridge-scope 400, the `validateWsUpgrade` 401 and the no-auth 403 branches `socket.destroy()` silently.
- `ToolBurstGroup.tsx`: `autoOpen = prefs.toolGroupDefaultCollapsed ? false : isRunning`. `ToolCallStep` is already collapsed by default on every viewport.

## Goals / Non-Goals

**Goals:**
- The cold landing on any device stops paying for the full icon set.
- A single server log is enough to tell apart: a client process dying (`1006`, no keepalive timeout), a silent middlebox (keepalive timeout), and a rejected upgrade (rejection line).
- Streaming on mobile stops auto-mounting running tool-group bodies.

**Non-Goals:**
- Per-device display preferences, or mobile defaults for reasoning/tool results (a larger preferences-model change; follow-up if the Jetsam evidence points at DOM volume).
- Making `markdown` lazy (chat needs it on first paint of any transcript).
- Virtualizing the streaming tail, or a `visibilitychange` memory trimmer.
- Any client-side WS protocol change (browsers answer protocol pings natively).

## Decisions

### D1: Lazy full icon set through a *distinct module identity*
The key-resolvers call `loadMdiIconSet()`, which does `import("@mdi/js/commonjs/mdi.js")` and memoizes the resulting promise and record. They render through a `useMdiIconByKey(key): string | null` hook, which returns `null` until the set resolves and then re-renders. The loader and hook live in `client-utils` (`ActionList`/`StatusPill` already live there, and plugins consume them). `mdi-icon-lookup.ts` becomes a thin re-export so its callers change only from a sync call to the hook.

Why a distinct path: Rollup cannot split one module across chunks. If the dynamic import targeted `@mdi/js` (the same module the ~150 named imports use), the whole namespace would stay in the eager graph, and the build would print the `dynamic import will not move module` warning. `@mdi/js` has no `exports` map, so the `commonjs/mdi.js` deep path resolves and is a separate module. It carries the same icon data (package v7.4.47).

The `mdi` entry is **removed from `manualChunks`**. Otherwise the matcher `/node_modules/@mdi/js/` would pull `commonjs/mdi.js` back into the same chunk, which is reachable from the entry. Named imports then tree-shake into `index`.

Alternatives considered:
- A Vite plugin that emits a virtual `virtual:mdi-all` module. It also works, but it adds build plumbing in `client`, while the consumer lives in `client-utils`. We keep it as the fallback if CJS interop misbehaves in dev (task 1.x checks the dev server).
- A curated allowlist of supported keys. Rejected: it narrows the extension-UI contract ("any `@mdi/js` key").
- Serving a JSON of icon paths from the server. Rejected: it adds a new route for a static asset.

### D2: Browser keepalive: 30 s ping, terminate after 2 missed intervals
Each browser socket gets `missedPongs` (reset to 0 on `pong`). A gateway-level `setInterval` increments it and pings. At `missedPongs >= 2` the socket is `terminate()`d and logged `keepalive timeout`. The interval is injectable (`browserPingIntervalMs`) for tests and cleared in `stop()`.

Why not 15 s / 1 miss (the reporter's patch): iOS suspends backgrounded tabs, and a tight timeout turns every app switch into a reconnect storm. A roughly 60–90 s detection window still catches dead peers, well before OS-level TCP timeouts.

### D3: Close line keeps the existing prefix
`[browser-gw] browser client disconnected (remaining: N) code=<n> reason=<JSON string> lifetime=<s>s frames=<n>`. Existing greps on the prefix keep working. `reason` goes through `JSON.stringify`, so quotes and newlines cannot break the line. `frames` counts inbound `message` events; `lifetime` comes from a per-socket `connectedAt`.

### D4: One rejection logger, rate-limited, secret-free
New `packages/server/src/auth/ws-upgrade-reject-log.ts` exports `logWsUpgradeRejection({status, scope, remoteAddress, headers, ticketPresent})`, which every rejecting branch in the upgrade handler calls. It logs the forwarding-header **names**, using the same header list as `hasProxyForwardingHeaders`, so the two cannot drift. It never logs values, cookies or tickets. Rate limiting uses a `Map<status|scope|addr, {windowStart, suppressed}>` with a 60 s window. The map is capped (256 entries; expired entries pruned on insert, oldest evicted) so a scanning peer cannot grow memory without bound.

### D5: Mobile tool groups
`autoOpen = (prefs.toolGroupDefaultCollapsed || isMobile) ? false : isRunning`. The manual override still wins. This is one line and keeps the preference model unchanged (see Non-Goals).

## Risks / Trade-offs

- [Icon pop-in: key-resolved icons paint a tick later on first use] → They are secondary (extension actions, status pills). Render an empty fixed-size slot so layout doesn't shift.
- [CJS deep import behaves differently under the Vite dev server's optimizer] → Task checks dev; fallback is the D1 virtual module.
- [Duplicate icon data: named-import icons exist both in `index` and in the lazy CJS chunk] → Only the handful of named icons are duplicated, which is negligible against 2.78 MB removed from the cold path.
- [Keepalive terminates a tab the OS suspended in the background] → Intended. The client's existing reconnect/backoff (`mobile-resilience`) restores it on resume.
- [Log volume from misconfigured tunnels] → D4 rate limit plus suppressed counts.

## Migration Plan

No data, protocol or config migration. Deploy is a normal release. Rollback is `git revert` of the change commit; nothing persists across it.

## Open Questions

- Whether the reporter's iOS Jetsam log confirms a memory kill. That doesn't change this change's scope; it decides whether the per-device-preferences follow-up is worth doing.
