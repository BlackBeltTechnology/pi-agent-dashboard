# Design — Universal Network Guard

> Revised after doubt-driven-review (single-model + cross-model @propose-review-1).
> The first draft tried to *enumerate every public surface* and deny everything
> else; two independent reviewers showed that is unimplementable (hashed static
> assets rooted at `/`, SPA history-fallback via `setNotFoundHandler`) and would
> brick the flagship "auth off, over a tunnel" deployment. This design pivots to
> **scoping the guard's jurisdiction to the sensitive API namespaces.**

## Problem restated

`networkGuard` is a per-route `preHandler`. Enforcement is opt-in, and three
surfaces were never opted in (plugin routes, provider-auth, models-introspection).
With OAuth off (the default), the rejecting auth `onRequest` hook is not even
registered, so those surfaces are ungated (audit VD2 = RCE over the tunnel). The
fix must make enforcement structural for the dangerous surface, **without** trying
to enumerate — and inevitably missing — the public surface.

## Decision: namespace-scoped universal `onRequest` guard

Install the guard once as a Fastify `onRequest` hook whose **jurisdiction is the
sensitive HTTP namespaces**: `/api/*`, `/v1/*`, `/editor/*`, `/live/*`. Within
jurisdiction, deny-by-default: a request is allowed iff it satisfies a pass
condition or an in-namespace public exception. **Outside jurisdiction the guard
does nothing** — static assets, the SPA shell (`/` and deep-link refresh via
`setNotFoundHandler`), `/manifest.json`, `/auth/*`, favicon, and PWA icons are
served exactly as today.

Verified: every dangerous route in `server.ts` + `routes/*.ts` is under `/api`,
`/v1`, `/editor`, or `/live`. `/reload` is not a route (it is a prompt-text
literal). `/ws` is the WebSocket upgrade path, handled separately (below).

**Correction (review cycle 2): the original scan excluded the plugin packages and
missed `/mcp`.** `mcp-server-plugin` registers `/mcp`, `/mcp/observe`,
`/mcp/control` and a `/mcp/*` catch-all (`packages/mcp-server-plugin/src/server/routes.ts:194,331-333,352-353`)
— a remote tool-execution surface outside all four prefixes. See the `/mcp`
section below. Automation/flows/kb plugins register under `/api/plugins/...`
(e.g. `automation-plugin/src/server/routes.ts:240`) and are in jurisdiction, but
nothing structurally forces a plugin to stay under `/api` — that is what the
coverage test is for.

## `/mcp/*` — independently authenticated, deliberately out of jurisdiction

`/mcp` authenticates in-handler via `host.verifyDeviceToken` /
`host.verifyDeviceTokenTier` and **deliberately does not trust
`request.isAuthenticated`** (`server.ts:1185-1191`). Putting it in jurisdiction
would 403 every legitimate remote MCP client (device token present,
`isAuthenticated` still false) — a lockout, not a fix.

Decision: `/mcp` stays **out of jurisdiction**, and is classified as an
**independently-authenticated namespace**, not an unguarded one. The
coverage test (below) SHALL carry an explicit enumerated set of such namespaces
(`/mcp` today) rather than silently ignoring anything that is not `/api|/v1|
/editor|/live`; adding a namespace to that set is a deliberate, reviewable act.
A task verifies every `/mcp*` route (including the bare `/mcp`, which has no
trailing slash) passes through the plugin's own auth.

### Why not "deny-all + enumerate public" (rejected)
Static assets are hashed files rooted at `/` with no distinct prefix; `/` and
every SPA deep-link route through `setNotFoundHandler` (three registrations —
`server.ts:2105` production SPA fallback, plus the `2129`/`2134` variants), which
runs *after* `onRequest`. A deny-by-default `onRequest` cannot know a path
resolves to a static file, so `GET /` would 403 over a tunnel with auth off — the
exact deployment the change targets. Enumerating favicon/robots/icons/SW is
whack-a-mole. Namespace scoping sidesteps the entire class.

(Correction: the first draft claimed no service worker exists. One does —
`packages/client/src/main.tsx:171` registers root-scoped `/sw.js`. It is out of
jurisdiction so it keeps loading, but `/sw.js` MUST appear in the coverage test's
static-allow set.)

### Pass conditions (in-jurisdiction, unchanged from `createNetworkGuard`)
- loopback / genuine-local (`isGenuinelyLocal`, incl. local-token),
- source IP in the trusted-network set — read through the **live thunk**
  `() => liveTrustedNetworks(config.resolvedTrustedNetworks ?? [])`
  (`server.ts:1498`, D15), **never** a boot snapshot, so a CIDR added at runtime
  admits without a restart,
- `request.isAuthenticated === true`.

### Denial shape is preserved (not just "a log line")
The universal guard SHALL reuse `createNetworkGuard`'s denial path verbatim:
the `{ error: "network_not_allowed", reason, hint }` body the client branches on
(`ServerSelector.tsx`, `PathPicker.tsx`, `ConnectionStatusBanner.tsx`) **and** the
`blockEvents` recording (`localhost-guard.ts:184-191`) that feeds
`GET /api/tunnel/block-events`. Because the universal hook denies first, Fastify
skips the retained per-route `preHandler` — so if the hook's denial shape
differed, previously-guarded routes would change response shape and the
trust-this-network UI would go dark. "No body/token" in the observability task
constrains the **log line**, not the 403 response body.

### In-namespace public exceptions (reachable unauthenticated within `/api`)
- `GET /api/health`,
- `PUBLIC_PAIRING_PREFIXES` (`/api/pair/challenge`, `/api/pair/redeem`,
  `/api/pair/poll` — pairing bootstrap),
- configured `auth.bypassUrls` prefixes.

## `/v1/*` model proxy (load-bearing correction)

`/v1/*` is owned by the model-proxy auth gate (`createModelProxyAuthGate`), a
separate credential system (`pi-proxy-*` API keys with `FailedAuthBackoff`). Today
`auth-gate.ts` validates the key but **returns without setting
`request.isAuthenticated`** (success `return` at `auth-gate.ts:~112`), and the
auth-plugin skips `/v1/` (`auth-plugin.ts:311`) precisely because the proxy gate
owns it.

Therefore:
1. **The proxy gate SHALL set `request.isAuthenticated = true` on successful key
   validation.** Then the universal guard admits proxy-authenticated `/v1/*`
   traffic via the normal `isAuthenticated` pass condition — no `/v1` public
   allowlist entry (which would be a hole: with modelProxy disabled a public
   `/v1` skip bypasses all auth).
2. This makes the guard's **ordering** load-bearing beyond the two auth hooks:
   the guard SHALL be the **last** `onRequest` hook, registered **after**
   `registerBearerAuth` (`server.ts:1471`), `registerAuthPlugin` (when present,
   `server.ts:1473`), **and** `proxyAuthGate` (model-proxy block,
   `server.ts:2005`), so
   `isAuthenticated` reflects every auth source before the guard evaluates. The
   first draft's ordering discussion covered only the two auth hooks and missed
   the proxy gate — corrected here.

## Model-proxy second port (cycle-2 finding)

When `modelProxy.secondPort` is configured the server spins up a **separate**
Fastify instance (`server.ts:2948-2972`) that registers **only** `proxyAuthGate`
— no universal guard, no `isAuthenticated` decoration, no network check. It is
safe today solely because it binds hardcoded `127.0.0.1`. That is safe-by-accident.

Decision: the second-port bind SHALL be a documented, **test-asserted loopback
invariant** — it binds `127.0.0.1` only, never `config.host`. If that bind is ever
made configurable, the universal guard (with `isAuthenticated` decoration) MUST be
installed on the second instance too. The main-instance `/v1/*` path is covered by
the guard-last ordering + proxy-gate `isAuthenticated` fix above; the second port
is covered by the loopback invariant. `/editor/*` is a no-op namespace in the
standalone/bridge server (the editor proxy ships only in the Electron bundle);
keeping it in the jurisdiction list is future-proofing, with one cost: an
unmatched in-jurisdiction path 403s instead of falling through to the SPA
handler, so no client-side route may ever live under `/editor/` (asserted by the
coverage test). Jurisdiction
prefix matching SHALL anchor on `/api/`, `/v1/`, `/editor/`, `/live/` (trailing
slash) to avoid a `/apiv2`-style near-miss.

## Ordering summary

Fastify runs `onRequest` hooks in registration order. The real root chain is
longer than the first draft's four entries:

`createHostGate` (1429) → `@fastify/cors` (1430) → `createMutationOriginGate`
(1456) → CSP (1462) → `registerBearerAuth` (1471) → `registerAuthPlugin`
(conditional, 1473) → `createRouteTierGate` (1488) → `proxyAuthGate`
(conditional, 2005) → **universal guard**.

The requirement is **last unconditionally**, not "after proxyAuthGate" — with
`modelProxy` disabled that anchor does not exist. Several earlier hooks
(host-gate, mutation-origin-gate) already reply on some paths, so the guard is
the sole enforcer for *network policy*, not the only rejecting hook.

### Load-bearing Fastify behavior (was unstated)
Registering the guard last still covers routes registered **earlier** (1504-2037)
because Fastify binds hooks to routes at `preReady`, not at registration. This
also covers the MCP plugin's encapsulated child scope. It does **NOT** cover any
route registered after `ready()` — plugin activation here is "effective at next
restart", so this holds today; a future hot-load-a-plugin feature would silently
reopen VD2. Recorded as an invariant. `request.isAuthenticated` is already
decorated `false` unconditionally at `server.ts:1467`, so the guard reads a
defined value on every path including auth-off.

## Path matching (pathname, anchored)

Jurisdiction and exception matching SHALL run on the parsed **pathname**, not
`request.url`. On a malformed URL that cannot be parsed, the guard SHALL **fail
closed** — treat the request as in-jurisdiction and deny.

The `/api/health` exception SHALL admit `HEAD` as well as `GET` (Fastify
auto-exposes HEAD for a GET route).

**Known divergence, accepted:** with auth ON, the unchanged `auth-plugin` hook
runs *first* and matches exemptions on raw `request.url`
(`auth-plugin.ts:306-315`), so `/api/health?probe=1` is still rejected there
before the guard's better matcher runs. Unifying the two matchers is out of scope
for this change; the guard's pathname matching is what governs the auth-off path
(the one this change exists to fix). Recorded so the improvement is not
overstated. The existing auth-plugin compares `request.url === "/api/health"`
(`auth-plugin.ts:308`), which already misses `/api/health?probe=1`; reusing that
shape in the guard would import the same defect (and its inverse — a loose prefix
admitting `/api/healthz`). Jurisdiction prefixes anchor on the trailing slash
(`/api/`, `/v1/`, `/editor/`, `/live/`); fixed exceptions compare the pathname
exactly; `PUBLIC_PAIRING_PREFIXES` / `bypassUrls` match as anchored prefixes.

## WebSocket path (unchanged)

The guard is HTTP-only; it does not run on WS upgrades. WS continues through
`validateWsUpgrade` + single-use scoped ws-ticket; the durable bearer never rides
the socket. The **ws-ticket mint endpoint is under `/api` → guarded (requires a
pass condition), NOT public** — an unauthenticated client cannot mint a ticket.
(The first-draft proposal wrongly allowlisted the mint; corrected — see proposal.)

## CORS / OPTIONS preflight

`@fastify/cors` is registered at `server.ts:1430`, before the guard, and answers
preflight `OPTIONS` in its own path — preflight is not denied by the guard.
Recorded as a precondition; a scenario asserts cross-origin preflight still works.

## Enforcement semantics (accurate, not overstated)

- **Auth OFF (default):** the auth-plugin's rejecting hook is not registered, so
  the universal guard is the **sole** enforcer for `/api`/`/v1` sensitive routes —
  this is the audit gap it closes.
- **Auth ON:** the auth-plugin's `onRequest` already replies (redirect/401) for
  unauthenticated non-skip requests before the guard; the guard then acts as
  defense-in-depth and closes the auth-plugin skip-list interplay. The guard does
  **not** "replace" the auth-plugin — it supplements it and is the primary
  enforcer only in the auth-off case.

## Retained per-route `preHandler: networkGuard`

Kept as redundant defense-in-depth. No double-reply: if the universal hook denies,
the route `preHandler` never runs; if it allows, the `preHandler` re-checks and
also allows. Removing them is out of scope.

**Accepted trade-off (review cycle 2):** the pass conditions agree, but the
*exception* classes do not — `auth.bypassUrls` is a guard exception and is NOT a
`createNetworkGuard` pass condition (`localhost-guard.ts:210-241`). So a route
that both matches a configured `bypassUrls` prefix and carries a per-route
`networkGuard` is admitted by the hook and then 403'd by the preHandler. This is
**exactly today's behavior** (bypassUrls has always only skipped the auth plugin,
never the per-route guard), so the change introduces no regression — but the
exception does not widen access on guarded routes, and that is now stated rather
than implied. The public pairing routes are unaffected because they carry no
`networkGuard` (`pairing-routes.ts:119-122,156-159,207-210`) — recorded so a later
"add the guard everywhere" cleanup does not break pairing bootstrap.

## Safety net (new)

A test SHALL assert that every registered non-static route resolves under a
guarded namespace (`/api`, `/v1`, `/editor`, `/live`) OR an explicit
public/auth/static set — so a future dangerous route added outside the guarded
prefixes cannot silently slip the guard. This preserves the deny-by-default
guarantee that motivated the change, given jurisdiction is prefix-scoped.

## Accuracy corrections vs first draft (for the record)

- Pass conditions are **reused** but the guard is **not** byte-identical to
  `createNetworkGuard` — it adds jurisdiction scoping, in-namespace exceptions,
  and proxy-gate deferral.
- The change **does** intentionally alter behavior: previously-ungated `/api`
  sensitive routes become guarded when auth is off. The *non-change* is the pass
  conditions.
- No service worker exists in the client build; that allowlist entry is dropped.

## Risk & mitigation

- **A sensitive route added outside `/api`/`/v1`/`/editor`/`/live`** → not
  guarded. Mitigation: the namespace-coverage test above.
- **Proxy-gate ordering/`isAuthenticated` regression** → `/v1` bricks or opens.
  Mitigation: scenarios — valid `pi-proxy-*` key passes, missing/invalid key
  denied, modelProxy-disabled `/v1` denied.
- **SPA/login lockout** → eliminated by construction (public surface is out of
  jurisdiction), asserted by a "shell loads with auth off over a tunnel" scenario.
- **`/mcp` treated as unguarded rather than independently authenticated** →
  mitigated by the enumerated independently-authenticated set in the coverage
  test plus a task verifying every `/mcp*` route self-authenticates.
- **Accepted, documented:** with `modelProxy` disabled the `/v1` routes do not
  exist, so a loopback or authenticated `/v1/*` request falls through to
  `setNotFoundHandler` and gets `200` `index.html`. Remote/unauthenticated is
  correctly 403'd, which is what the contract requires; the loopback HTML answer
  is pre-existing SPA-fallback behavior, not a new hole.
