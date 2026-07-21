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

Verified: every dangerous route in the codebase is under `/api`, `/v1`, `/editor`,
or `/live` (route-prefix scan of `server.ts` + `routes/*.ts`). `/reload` is not a
route (it is a prompt-text literal). `/ws` is the WebSocket upgrade path, handled
separately (below). So namespace scoping covers 100% of the audit's dangerous
routes while structurally excluding the un-enumerable public surface.

### Why not "deny-all + enumerate public" (rejected)
Static assets are hashed files rooted at `/` with no distinct prefix; `/` and
every SPA deep-link route through `setNotFoundHandler` (`server.ts:1530`), which
runs *after* `onRequest`. A deny-by-default `onRequest` cannot know a path
resolves to a static file, so `GET /` would 403 over a tunnel with auth off — the
exact deployment the change targets. Enumerating favicon/robots/icons/SW is
whack-a-mole (and the first draft even listed a service worker that does not
exist in the build). Namespace scoping sidesteps the entire class.

### Pass conditions (in-jurisdiction, unchanged from `createNetworkGuard`)
- loopback / genuine-local (`isGenuinelyLocal`, incl. local-token),
- source IP in `resolvedTrustedNetworks`,
- `request.isAuthenticated === true`.

### In-namespace public exceptions (reachable unauthenticated within `/api`)
- `GET /api/health`,
- `PUBLIC_PAIRING_PREFIXES` (`/api/pair/challenge`, `/api/pair/redeem`,
  `/api/pair/poll` — pairing bootstrap),
- configured `auth.bypassUrls` prefixes.

## `/v1/*` model proxy (load-bearing correction)

`/v1/*` is owned by the model-proxy auth gate (`createModelProxyAuthGate`), a
separate credential system (`pi-proxy-*` API keys with `FailedAuthBackoff`). Today
`auth-gate.ts` validates the key but **returns without setting
`request.isAuthenticated`** (`auth-gate.ts:110-112`), and the auth-plugin skips
`/v1/` precisely because the proxy gate owns it.

Therefore:
1. **The proxy gate SHALL set `request.isAuthenticated = true` on successful key
   validation.** Then the universal guard admits proxy-authenticated `/v1/*`
   traffic via the normal `isAuthenticated` pass condition — no `/v1` public
   allowlist entry (which would be a hole: with modelProxy disabled a public
   `/v1` skip bypasses all auth).
2. This makes the guard's **ordering** load-bearing beyond the two auth hooks:
   the guard SHALL be the **last** `onRequest` hook, registered **after**
   `registerBearerAuth`, `registerAuthPlugin` (when present), **and**
   `proxyAuthGate` (registered in the model-proxy block, `server.ts:~1418`), so
   `isAuthenticated` reflects every auth source before the guard evaluates. The
   first draft's ordering discussion covered only the two auth hooks and missed
   the proxy gate — corrected here.

## Model-proxy second port (cycle-2 finding)

When `modelProxy.secondPort` is configured the server spins up a **separate**
Fastify instance (`server.ts:~1875-1895`) that registers **only** `proxyAuthGate`
— no universal guard, no `isAuthenticated` decoration, no network check. It is
safe today solely because it binds hardcoded `127.0.0.1`. That is safe-by-accident.

Decision: the second-port bind SHALL be a documented, **test-asserted loopback
invariant** — it binds `127.0.0.1` only, never `config.host`. If that bind is ever
made configurable, the universal guard (with `isAuthenticated` decoration) MUST be
installed on the second instance too. The main-instance `/v1/*` path is covered by
the guard-last ordering + proxy-gate `isAuthenticated` fix above; the second port
is covered by the loopback invariant. `/editor/*` is a no-op namespace in the
standalone/bridge server (the editor proxy ships only in the Electron bundle);
keeping it in the jurisdiction list is harmless future-proofing. Jurisdiction
prefix matching SHALL anchor on `/api/`, `/v1/`, `/editor/`, `/live/` (trailing
slash) to avoid a `/apiv2`-style near-miss.

## Ordering summary

Fastify runs `onRequest` hooks in registration order. Required order:
`registerBearerAuth` → `registerAuthPlugin` (conditional) → `proxyAuthGate`
(conditional) → **universal guard (last)**. `request.isAuthenticated` is already
decorated `false` unconditionally at `server.ts:983`, so the guard reads a defined
value on every path including auth-off.

## WebSocket path (unchanged)

The guard is HTTP-only; it does not run on WS upgrades. WS continues through
`validateWsUpgrade` + single-use scoped ws-ticket; the durable bearer never rides
the socket. The **ws-ticket mint endpoint is under `/api` → guarded (requires a
pass condition), NOT public** — an unauthenticated client cannot mint a ticket.
(The first-draft proposal wrongly allowlisted the mint; corrected — see proposal.)

## CORS / OPTIONS preflight

`@fastify/cors` is registered at `server.ts:938`, before the guard, and answers
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
