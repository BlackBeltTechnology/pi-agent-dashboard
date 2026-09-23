## Context

See proposal.md for motivation (issue #712). State of `develop` that shapes the approach:

- `dist/index.html` `modulepreload`s `react-vendor`, `util`, `markdown`, `mdi` (2,780,948 B raw), `jsdiff`, `dnd`. `xterm`/`diff` are already lazy (#694, `lazy-feature-preload.test.ts`).
- Two things together make the full icon set eager. (a) `vite.config.ts` `manualChunks` maps every `/node_modules/@mdi/js/` module to one `mdi` chunk, and ~225 files, including built-in plugins pulled in statically by `generated/plugin-registry.tsx`, import icons by name, so that chunk is reachable from the entry. (b) Three modules do `import * as mdi from "@mdi/js"` and look up keys at runtime, which defeats tree-shaking: `packages/client/src/lib/preview/mdi-icon-lookup.ts` (`resolveMdiIcon`, used by `GenericExtensionDialog` and, inside a `.map`, by `FooterSegmentSlot`), `packages/client-utils/src/ActionList.tsx` and `packages/client-utils/src/StatusPill.tsx`. `client-utils` is consumed from source (its `exports` map points at `./src/*.tsx`).
- The existing guard `mdi-chunk-size.test.ts` inspects only the entry script, not `modulepreload` hrefs or static imports, so the eager `mdi` chunk passes it today.
- `browser-gateway.ts`: `ws.on("close", () => …)` ignores `(code, reason: Buffer)`. There is no ping timer and **no `stop()`**; shutdown calls only `browserGateway.wss.close()` (`server.ts` ~L3373). One server-initiated `terminate()` already exists (pending-state byte ceiling, "stalled").
- `server.ts` upgrade handler: the host gate (`[host-gate]`, rate-limited in `host-gate.ts`) and the plugin/cross-origin gates (`[ws-gate]`) already log rejections. The silent branches are the bridge-scope **400**, the `validateWsUpgrade` **401** (auth secret set) and the no-auth **403**. 404s are for unrouted paths, not auth decisions.
- `localhost-guard.ts`: `PROXY_FORWARDING_HEADERS` / `PLUGIN_PROXY_FORWARDING_HEADERS` are module-private; `hasProxyForwardingHeaders` returns only a boolean.
- `ToolBurstGroup.tsx`: `autoOpen = prefs.toolGroupDefaultCollapsed ? false : isRunning`; `useMobile()` is called only in the nested `GroupFrame`. `ToolCallStep` starts collapsed *except* for image results, a running `Agent` tool, and `ask_user`.

## Goals / Non-Goals

**Goals:**
- The cold landing on any device stops paying for the full icon set.
- A single server log is enough to tell apart: a client process dying (`cause=peer code=1006`), a silent middlebox (`cause=keepalive`), and a rejected upgrade (rejection line).
- Streaming on mobile stops auto-mounting running tool-group bodies.

**Non-Goals:**
- Per-device display preferences, or mobile defaults for reasoning/tool results (a larger preferences-model change; follow-up if the Jetsam evidence points at DOM volume).
- The `ToolCallStep` auto-expand exceptions (images, running Agent, `ask_user`). They are intentional UX and stay as they are, even though `mobile-resilience` "Tool calls collapsed on mobile" says "no exception". That pre-existing drift is out of scope.
- Making `markdown` lazy (chat needs it on first paint of any transcript).
- Virtualizing the streaming tail, or a `visibilitychange` memory trimmer.
- Any client-side WS protocol change (browsers answer protocol pings natively).
- Re-logging rejections that `[host-gate]` / `[ws-gate]` already log, or logging 404/unrouted destroys.

## Decisions

### D1: Lazy full icon set through a *distinct module identity*
A new client-utils module `mdi-by-key.ts` exports:
- `loadMdiIconSet(): Promise<Record<string,string> | null>`. It memoizes one `import("@mdi/js/commonjs/mdi.js")` promise and reads the record as `mod.default ?? mod`, because CJS interop may surface the namespace under `default`. A failed import (for example a chunk fetch error on a flaky network) resolves to `null` with no unhandled rejection and **clears the memo**, so a later call retries. Icons simply stay absent in the meantime.
- `resolveMdiIconSync(key): string | null`. Synchronous; it returns the path only if the set has already loaded (unknown key, non-`mdi` prefix or not-yet-loaded → `null`).
- `useMdiIconByKey(key): string | null`. Returns `resolveMdiIconSync(key)`, and if the set isn't loaded yet it triggers `loadMdiIconSet()` and re-renders once it resolves.

The module is published as a new `./mdi-by-key` subpath in `packages/client-utils/package.json` `exports` (the map is explicit per subpath; without an entry `tsc --noEmit` rejects the import even though the Vite alias would resolve it). `mdi-icon-lookup.ts` keeps `resolveMdiIcon` as a **synchronous** re-export of `resolveMdiIconSync` (its existing unit tests preload the set first) and adds a re-export of the hook. **Every production render site moves to the hook.** The sync resolver stays only for non-render callers and tests, and a component test per surface asserts the icon appears after load, so a sync-only caller that would never re-render is caught. `FooterSegmentSlot` gets a per-segment `FooterSegment` component, because a hook can't run inside `.map`.

While the set is loading, and for unknown keys, the icon renders **nothing**: no placeholder slot, so "unknown key renders no icon" (extension-ui-system) holds and there is a single render rule. A one-time small shift on first use is accepted.

Why a distinct path: Rollup cannot split one module across chunks. If the dynamic import targeted `@mdi/js` (the same module the named imports use), the whole namespace would stay in the eager graph and the build would print `dynamic import will not move module`. `@mdi/js` has no `exports` map, so `commonjs/mdi.js` resolves as a separate module with the same data (v7.4.47).

The `mdi` entry is **removed from `manualChunks`**; otherwise its `/node_modules/@mdi/js/` matcher would pull `commonjs/mdi.js` back into an entry-reachable chunk. Named imports then tree-shake into `index` (reviewer-measured ~125 icons, ~4.6 KB gz; `index` stays under the 900 KB gz cap).

Guard: `mdi-chunk-size.test.ts` walks the landing graph. It starts from `index.html`'s entry script plus its `modulepreload` hrefs, then follows static `import … from"./x.js"` / `import"./x.js"` specifiers in each chunk transitively. It asserts that no chunk in that graph contains `mdiZodiacAquarius` and that some emitted chunk does.

Alternatives considered:
- A Vite plugin emitting a virtual `virtual:mdi-all` module. Kept as the fallback if CJS interop misbehaves under the dev optimizer or the chat-embed bundler (task 1.7).
- A curated allowlist of keys. Rejected: it narrows the extension-UI contract.
- A server-served JSON of icon paths. Rejected: it adds a route for a static asset.

### D2: Browser keepalive: 30 s ping, terminate on the third tick without a pong
Per-socket state lives in a `WeakMap<WebSocket, {connectedAt, frames, missedPongs, cause?}>`, so closed sockets need no explicit cleanup. On `pong`, `missedPongs = 0`. On each gateway tick (default 30 s, injectable as `browserPingIntervalMs`), for every open socket:
- if `missedPongs >= 2`, set `cause = "keepalive"` and `terminate()`;
- otherwise `missedPongs++` and `ping()`.

A peer that dies right after a pong is terminated on the third tick, so the detection window is **60–90 s**. That is two whole unanswered pings, not one.

The interval is `unref()`'d behind the repo's existing guard (`if (typeof t.unref === "function") t.unref()`, as in `worktree-init.ts` / `tunnel-watchdog.ts`), because fake timers may not return a Node `Timeout`. It is cleared in a `wss.on("close")` listener, which needs no new gateway API. Caveat: `ws`'s `WebSocketServer.close()` defers its `close` event until every client has gone. The shutdown path already `terminate()`s all clients before `wss.close()` (`server.ts` ~L3370), so the event fires; tests must do the same. Ticks during that brief window are harmless: they only iterate the remaining clients.

Why not 15 s / 1 miss (the reporter's patch): iOS suspends backgrounded tabs, and a tight timeout turns every app switch into a reconnect storm.

### D3: One close line per socket, carrying the cause
`[browser-gw] browser client disconnected (remaining: N) code=<n> reason=<JSON string> lifetime=<s>s frames=<n> cause=<peer|keepalive|stalled>`
- The existing prefix is kept, so existing greps still work.
- `reason` is `JSON.stringify(reason.toString("utf8"))`: it is a Buffer in `ws`, and stringify keeps quotes and newlines from breaking the line.
- `cause` defaults to `peer`. The keepalive path sets `keepalive`; the existing stalled-byte-ceiling `terminate()` sets `stalled` (a one-line flag).

A keepalive kill therefore produces exactly one line (`cause=keepalive code=1006`), which is distinguishable from a peer death (`cause=peer code=1006`).

### D4: Rejection logger for the silent branches: per-server, rate-limited, secret-free
New `packages/server/src/auth/ws-upgrade-reject-log.ts` exports `createWsUpgradeRejectLogger({windowMs=60_000, maxKeys=256, now=Date.now, log=console.error})`. It returns `log({status, scope, remoteAddress, headers, ticketPresent})`, emitting:

`[ws-upgrade] rejected status=<n> scope=<s> peer=<addr> fwd=<comma-names|none> ticket=<present|absent>[ suppressed=<n>]`

- The server creates one instance at startup, so no module-global state and tests inject a clock.
- Only the silent **400 (bridge scope), 401 and 403 (no-auth)** branches call it. `[host-gate]`/`[ws-gate]` lines are left untouched, so there is no double logging.
- `ticketPresent` comes from `extractTicket(...) !== null` (it returns `string | null`), evaluated without consuming the ticket. The bridge 400 computes it the same way; it only reads the URL and the `Sec-WebSocket-Protocol` header.
- Forwarding-header **names** come from a new `localhost-guard.ts` export, `forwardingHeaderNamesPresent(headers): string[]`, built over the existing module-private lists: the extended (plugin) list, which is a superset of the core list `isGenuinelyLocal` consults. The logger may therefore name a header (`via`, `x-forwarded-server`, `x-forwarded-port`) that the core check ignored. That is intentional for diagnosis, and the lists stay defined in one module. Values, cookies and tickets are never read into the line.
- Rate limit: `Map<"status|scope|addr", {windowStart, suppressed}>`. Inside the window a line is suppressed and the counter increments. The first rejection after the window emits a line carrying `suppressed=<n>` and resets. When a new key would exceed `maxKeys`, expired entries are pruned first, then the oldest entry is evicted.

## Risks / Trade-offs

- [Icon pop-in: key-resolved icons paint a tick later on first use, possibly with a small shift] → They are secondary (extension actions, status pills, footer segments). A shift is preferred over a placeholder that would conflict with the unknown-key contract.
- [CJS deep import behaves differently under the Vite dev optimizer or the chat-embed consumer's bundler] → The loader unit test resolves a real key through the real import. Task 1.7 checks the dev server and the chat-embed example build; the fallback is the D1 virtual module.
- [A future `@mdi/js` 7.x adds an `exports` map that blocks the deep path] → The loader unit test fails at test time on the dependency bump, not at runtime in production.
- [Suppressed counts are lost when a key is evicted by the cap, or when the peer never retries after its window] → Accepted. The count is a volume hint, not an audit trail, and the first line for every key is always emitted.
- [The "Production build is free of mechanical warnings" requirement in `client-build-config` still names the archived `shrink-client-index-chunk` change as owner of the `@mdi/js` dynamic-import warning] → Left as is. The MODIFIED requirement here is now the normative owner, and the sibling's note is historical. Rewriting that long requirement adds churn for no behaviour change.
- [Duplicate icon data: named-import icons exist both in `index` and in the lazy chunk] → Only ~4.6 KB gz duplicated, against ~2.78 MB raw removed from the cold path.
- [Keepalive terminates a tab the OS suspended in the background] → Intended. The client's existing reconnect/backoff (`mobile-resilience`) restores it on resume.

## Migration Plan

No data, protocol or config migration. Deploy is a normal release. Rollback is `git revert` of the change commit; nothing persists across it.

## Open Questions

- Whether the reporter's iOS Jetsam log confirms a memory kill. It doesn't change this change's scope; it decides whether the per-device-preferences follow-up is worth doing.
