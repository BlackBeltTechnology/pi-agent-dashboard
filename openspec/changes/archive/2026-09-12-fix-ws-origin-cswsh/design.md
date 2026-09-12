## Context

See proposal.md — Why. Current state that shapes the approach:

- `packages/server/src/server.ts` `fastify.server.on("upgrade")` computes `scope = routeScopeForUrl(url)` (`browser` | `terminal` | `live` | `bridge` | `null`), early-returns `400` for `bridge`, then admits by: OAuth cookie (`validateWsUpgrade`) when `authConfig.secret` is set; otherwise `isGenuinelyLocal || verifyLocalToken || isBypassedHost || consumeTicket`. Nothing reads `request.headers.origin`. `pairing/browser-gateway.ts:530` only logs it.
- A **second WS listener** exists: the pi-gateway (`packages/server/src/pi/pi-gateway.ts`, TCP `verifyClient` → `decideBridgeUpgrade` in `pi/bridge-upgrade-auth.ts`). With `requireTicketOnLoopback: false` (deprecation grace, `server.ts:828`) a tokenless loopback peer is admitted — including a browser page dialling `ws://127.0.0.1:<piPort>` from any site. No browser client ever legitimately dials the pi port (client references to `piPort` are display/settings only).
- `packages/server/src/auth/cors-origin.ts` `isCorsOriginAllowed(origin, opts)` is the single, unit-tested origin-trust decision for CORS (no-Origin→allow, `null`→deny, loopback→allow, tunnel/zrok/`pi-dashboard.dev`/configured/trusted-network→allow, else deny). `server.ts` already wires it with live tunnel + trusted-network thunks.
- Browsers always send `Origin` on WebSocket handshakes and on every non-GET fetch (including same-origin). Non-browser clients (bridge, `pi-dashboard` CLI, `curl`, the `pi-dashboard` skill) send none.
- Legitimate browser origins: Electron `http://localhost:<port>` (`packages/electron/src/main.ts:249`), Vite dev `http://localhost:5173`, served UI on loopback, zrok / other tunnels, `https://pi-dashboard.dev` PWA shell, `cors.allowedOrigins`, trusted-network LAN hosts. All already return `true` from `isCorsOriginAllowed`.
- `live-server-preview`: `LiveServerViewer.tsx` iframe is `sandbox="allow-scripts allow-forms allow-popups"` without `allow-same-origin` → opaque origin → its dev-server HMR WebSocket through `/live/:id` presents `Origin: null`.

## Goals / Non-Goals

**Goals:**
- Kill the #625 chain at the first hop: a hostile origin never completes an upgrade.
- Close the blind-CSRF primitive on every mutating `/api/*` route with one hook.
- Reuse the existing origin-trust decision so CORS-readability and WS/mutation-admission cannot drift.
- Zero behavior change for the dashboard's own clients and for header-less local tooling.

**Non-Goals:**
- Replacing loopback trust with a token (see D2).
- Changing broadcast fan-out (`terminal_added`, `sessions_snapshot`) or adding UI confirmations (see D2).
- Hardening the proxied `/editor` (code-server) or the previewed dev server itself.
- `Sec-Fetch-Site` / `Content-Type` enforcement (see D4).

## Decisions

### D1 — Gate on `Origin`, evaluated before every other WS admission branch

Add one pure helper next to `isCorsOriginAllowed`:

```ts
// auth/cors-origin.ts (or auth/origin-gate.ts)
export function isOriginAdmitted(origin: string | undefined, hostHeader: string | undefined, opts: CorsOriginOptions): boolean
export function isWsOriginTrusted(origin: string | undefined, hostHeader: string | undefined, scope: WsRouteScope | null, opts: CorsOriginOptions): boolean
export function isMutationOriginTrusted(origin: string | undefined, hostHeader: string | undefined, opts: CorsOriginOptions): boolean
```

Both build on `isCorsOriginAllowed` with two admission-specific deltas, in one shared `isOriginAdmitted(origin, hostHeader, opts)`:

1. **Same-origin by construction.** If the Origin's `host[:port]` equals the request `Host` header (compare after `new URL()` normalization of both — IPv6 brackets, default-port elision `http://host` ↔ `Host: host`, lower-casing), admit. Browsers set `Host` to the dialled target and `Origin` to the *calling* page; equality means the page was served by this dashboard at whatever name the user typed — mDNS hostnames (`http://mac.local:8000`, `mdns-discovery.ts`) for the page's own `/ws` and REST calls, a plain-LAN dashboard page posting `/api/pair/*`. (The cross-host server-switch staging dial from a *hostname-addressed* source page is not covered — its REST probe is already CORS-blocked today for the same reason, so nothing regresses; from a loopback page the Origin is loopback and passes.) `isBypassedHost` matches only IP literals, so without this rule every hostname-addressed same-origin client would 403 (CORS never applied to them, so "already broken" does not hold). Residual: DNS rebinding (attacker name resolving to the victim's loopback) satisfies the rule — but rebinding is fully open today with no Origin check at all, so this is no wider; Host allow-listing is a separate follow-up change.
2. **No blanket zrok wildcard.** The `*.share.zrok.io` / `*.shares.zrok.io` CORS branch is skipped for admission (`isCorsOriginAllowed` gains an `allowZrokWildcard` flag, default `true` for CORS, `false` here). Every tunnel the dashboard itself runs is a live tunnel origin and stays admitted. The wildcard must go because zrok shares are free and self-service: an attacker page on `evil.share.zrok.io` dialling `wss://victim.share.zrok.io/ws` is very likely *same-site* to the victim's tunnel (`SameSite=Lax` cookie rides the handshake), so the wildcard would let a stranger share defeat even the OAuth'd tunnel gate. Cost: an operator-run zrok share started *outside* the dashboard (`zrok share public` by hand) is neither live-tunnel nor Host-matched (zrok's frontend Host handling is not something this repo controls) — such setups add the share origin to `cors.allowedOrigins`. Release-note it.

`isWsOriginTrusted` adds the `live`-scope `null` carve-out (D3); every other scope — including `bridge` and `null` (unrouted path) — is strict. In the upgrade handler the check is the **first statement after computing `scope`**, ahead of the `bridge` `400` early-return and the `authConfig.secret` branch, so an untrusted Origin can never reach `consumeTicket` (spec: "Untrusted Origin does not consume a ticket") and cannot distinguish routed from unrouted paths. Response is `HTTP/1.1 403 Forbidden` + `socket.destroy()`, matching the existing no-auth rejection shape.

**Live options, not a snapshot.** `server.ts` already builds the CORS callback from live thunks (`corsAllowedOrigins()`, `corsTrustedNetworks()`, `getTunnelUrl`, `liveTunnelOrigins`). Extract that object construction into one `corsOpts(): CorsOriginOptions` closure and pass it to the CORS plugin, the WS gate and the REST gate, so tunnel rotation and runtime config edits are seen identically by all three.

*Why Origin, not a token:* the attack requires a browser, and browsers cannot omit or forge `Origin` on a WebSocket handshake. Absent-Origin is allowed because every non-browser local client sends none — and those already run as the same OS user with direct shell access; gating them buys nothing.

*Alternative — check inside each gateway (`browserGateway`, `terminalGateway`, live):* three places to drift, and `terminal-gateway.ts` today only checks id existence. One check at the listener covers all scopes.

### D2 — No per-session WS token, no broadcast scoping, no UI confirm (rejected)

Issue #625 suggests all three. Rejected for this change:
- **Token in no-OAuth mode**: only defends against a client that (a) reaches loopback and (b) can't be identified by Origin — i.e. a non-browser local process, which is already the user. It would also break `pi-dashboard` skill / CLI callers and every existing loopback test. `ws-ticket.ts` already exists for the remote case.
- **Scoping `terminal_added` to the creator**: the multi-tab / multi-device UI relies on the broadcast (`sessions_reordered` too). Once the hostile socket never opens, the broadcast leaks nothing.
- **UI confirm on `create_terminal`**: same reasoning; friction for the legitimate user with no residual threat.

Record in `doubt-driven-review` before landing (proposal → Discipline Skills).

### D3 — `live` scope admits `Origin: null`; `browser`/`terminal` reject it

The opaque-origin preview iframe is the only intended client of `/live/:id` WS (dev-server HMR; the proxy strips `origin` before forwarding, `live-server-proxy.ts:109`). Rejecting `null` there would silently break live preview HMR. Residual risk: an attacker's own sandboxed iframe (`Origin: null`) can dial `/live/<id>` — ids are `randomUUID().slice(0, 8)` (~32 bits), so secrecy is not the barrier. The reach is the user's own preview dev server (typically Vite HMR), which a hostile page can already dial directly on its loopback port; what the proxy adds is that it strips `origin` before forwarding, so a dev server that checks Origin itself would see none. Accepted for this change: the alternative (a per-live-id ticket embedded in the iframe URL) touches the live-preview client contract and is tracked as a follow-up, not folded into a security patch. `browser` and `terminal` keep the CORS policy's `null`-deny (`live-server-preview` spec: "CORS SHALL reject the opaque null origin").

### D4 — Mutating REST gate = one `onRequest` hook, Origin-only

```ts
fastify.addHook("onRequest", (req, reply, done) => {
  const routed = req.routeOptions?.url ?? "";          // matched route pattern, post-routing
  if (!(routed.startsWith("/api/") || routed === "/auth/logout")) return done();
  if (SAFE_METHODS.has(req.method)) return done();
  if (!isMutationOriginTrusted(req.headers.origin, req.headers.host, corsOpts())) { log; reply.code(403).send({ error: "untrusted origin" }); return; }
  done();
});
```

Registered once in `server.ts` after the CORS plugin. Fastify runs `onRequest` hooks *after* route matching, so `req.routeOptions.url` is the normalized route pattern — `//api/x` or `/foo/../api/x` either fails to route (404, no handler runs) or routes to the `/api/` pattern and is gated; raw `req.url` prefix matching is explicitly NOT used. `OPTIONS` is safe so preflights still get CORS headers (and then the actual cross-site request is refused by the same hook). Scoped to `/api/` plus `POST /auth/logout` (the one mutating auth route, `auth-plugin.ts:271`); OAuth login/callback are GET and stay reachable through tunnels; public pairing POSTs (`/api/pair/challenge|redeem|poll`) are called by the `pi-dashboard.dev` shell (`packages/shell/src/components/PairView.tsx`, admitted by the static branch) or by a dashboard page on the tunnel / a plain-LAN address (D1 rule 1) — all admitted; `/editor` and `/live` proxies keep their own policies; `/v1/*` model-proxy POSTs are already API-key gated and are left alone.

*Why not `Content-Type: application/json` enforcement or `Sec-Fetch-Site`:* body-less routes have no content type to require; `Sec-Fetch-Site` is absent from older browsers and from all non-browser clients, so it would need the same "absent → allow" fallback and add nothing over `Origin`. Origin-only is the smallest rule that closes the vector.

*Alternative — global `preHandler` on every route:* would hit `/editor` and `/live` proxies and the OAuth callback. `/api/` prefix is surgical.

### D4b — pi-gateway: presence of `Origin` is refusal

`decideBridgeUpgrade` gains one early rule: `headers.origin !== undefined` → `{ allow: false, cause: "browser-origin", reason: "tcp: browser Origin present — bridges never send one" }` (new member of the closed `BridgeRefusalCause` union; existing tests assert on it), placed **after** the existing `transport === "unix"` allow branch (`bridge-upgrade-auth.ts:85`) and before the local-token / ticket / deprecation-grace branches. No allow-list is needed because there is no legitimate browser peer; this keeps the gate independent of the dashboard's CORS state. The pure function is already unit-tested (`__tests__/bridge-upgrade-auth.test.ts`), so the rule is a table addition. Unix-socket peers bypass `decideBridgeUpgrade` entirely (kernel-authorised) and are unchanged.

### D5 — Logging shape

`console.error("[ws-gate] rejected upgrade origin=%s scope=%s peer=%s")` and `console.error("[csrf-gate] rejected %s %s origin=%s")` — one line each, same `[tag]` style as `[browser-gw]`. Origin, method and path are attacker-controlled: strip control characters and cap each at 256 chars before logging. No rate limiting (rejections are cheap and rare; a flood is itself the signal).

### D6 — Tests (TDD, real handler)

- Pure helper: extend `__tests__/cors.test.ts` style — table over (origin, host, scope) → expected, including Host-match normalization rows: `[::1]:8000`, `http://host` vs `Host: host` (default port), case, and a mismatch with equal host but different port; stranger-zrok denied vs live-tunnel-zrok admitted; `allowZrokWildcard` default unchanged for CORS.
- WS gate: `__tests__/ws-upgrade-routing.test.ts` pattern (`createTestServer`, real `ws` client with `headers: { origin }`), asserting `403` / `Unexpected server response` for attacker origin on `/ws`, `/ws/terminal/<id>` (spawn one via `create_terminal` on a trusted socket first), and `/live/<id>`; success for loopback origin, no origin, `null` on `live`, and `Host: mac.local:<port>` + matching hostname Origin.
- Ticket non-consumption: mint a ticket, attempt with attacker origin → 403, then reuse the ticket with a trusted origin → succeeds.
- REST gate: `fastify.inject` on `POST /api/tunnel-connect` with/without `Origin`, `POST //api/tunnel-connect`, `POST /auth/logout`, plus `GET`/`OPTIONS` with attacker origin → pass-through.
- pi-gateway: table rows in `__tests__/bridge-upgrade-auth.test.ts` (Origin present → deny, before grace/token/ticket) plus one real-listener case in `bridge-local-token-upgrade.test.ts` style dialling the TCP port with an `origin` header → `401`.

## Risks / Trade-offs

- [A legitimate browser client on an origin not in the CORS allow set loses WS] → It could not read REST today either, so it was already broken; `cors.allowedOrigins` is the existing fix. Call out in release notes.
- [Some future proxy strips `Origin`] → Gate degrades to today's behavior (absent → allow); never a false rejection.
- [`Origin` header case / trailing-slash variants] → `isCorsOriginAllowed` already parses with `new URL()`; reuse means one normalization path.
- [`live` `null` carve-out] → residual reach limited to the user's own preview dev server (D3). Revisit if `/live` ever proxies anything privileged.
- [Cross-host server switch from a hostname-addressed page] → staging WS now 403s at the target; its REST probe is already CORS-blocked (`server-selector` "cors-blocked" state) so the flow was not working from such pages. Fix, if wanted, is the same as today's: add the source origin to the target's `cors.allowedOrigins`.
- [Host-match rule and DNS rebinding] → rebinding is not made worse (fully open today); tracked as a follow-up (Host allow-list). Not a reason to drop the rule: without it hostname-addressed LAN use and plain-LAN pairing regress.
- [`pi-dashboard.dev` and trusted-network origins are blanket-admitted] → both are operator-chosen trust; a compromised LAN host was already able to reach every guarded route as a peer.
- [`Origin` header shape] → Node exposes `headers.origin` as `string | undefined`; duplicate headers are joined with `, `, which fails `new URL()` inside `isCorsOriginAllowed` and denies. Legacy `Sec-WebSocket-Origin` is not consulted — no supported browser sends it, and absent-Origin is today's behaviour, never wider.
- [Per-route stricter policies] → `/api/open-in-system` already denies *absent* Origin (`system-open-endpoints.test.ts`). The new gate is a floor, not a ceiling; do not "harmonize" such routes to absent→allow.
- [`/live/<anything>` without a valid id] → admitted by the Origin gate as `live`, then destroyed by the live proxy when no target exists; no reach beyond D3.
- [Hook ordering vs. `@fastify/cors`] → Register after CORS so a rejected cross-site request still carries no ACAO (opaque to the attacker either way).
- [E2E harness / QA scripts that drive WS from Playwright] → Playwright pages load from the dashboard origin (loopback or harness host, already CORS-trusted); `PI_E2E_SEED` loopback origin is exposed on purpose (`server.ts:391`). Run `npm run test:e2e` before ship.

## Migration Plan

Additive, no config or protocol change. Deploy = server restart. Rollback = revert. Ship as a patch release with a security note; respond on #625 after the fix is published (consider a GHSA advisory for 0.8.0 and earlier).
