# Add Universal Network Guard

## Why

`networkGuard` is opt-in per route. It is created once (`server.ts:1013`) and
passed as a `preHandler` to ~20 **core** route registrars (session, git, file,
grep, goal, system, tool, editor, …). Two classes of route never receive it:

1. **Plugin routes** — `automation-plugin`, `flows-plugin`, `kb-plugin` register
   on the shared Fastify instance via `ctx.fastify` but are never handed
   `networkGuard`.
2. **provider-auth + models-introspection routes** — omit the `preHandler`.

The only thing that would otherwise gate those routes is the OAuth `onRequest`
hook (`registerAuthPlugin`, `server.ts:989`) — but it is registered **only when
auth is configured**. The always-on `registerBearerAuth` hook merely *sets*
`request.isAuthenticated`; it never rejects. So in the **default deployment
(localhost, OAuth off, occasional zrok tunnel)** those routes have **no guard at
all**, while every core dangerous route stays protected by its per-route
`networkGuard` even with auth off.

The security-boundary-audit verified the consequence (VD2): over the tunnel,
`POST /api/plugins/automation/create` + `/run` write a prompt to an
attacker-chosen path and spawn a pi agent to execute it — **remote code
execution with auth off**. The same gap exposes `PUT /api/provider-auth/api-key`
(overwrite provider credentials) and `GET /api/provider-auth/status` (read masked
keys) to any LAN/tunnel caller.

Per-route opt-in is the root defect: the guard is exactly as strong as the
developer's memory to attach it, and three registrars forgot. This change makes
the guard **structural** so no route can be forgotten.

## What Changes

> **Design pivoted after doubt-driven review** (see `design.md`). The first draft
> tried to deny-everything-except-an-enumerated-public-allowlist; two reviewers
> showed that is unimplementable (hashed static assets rooted at `/`, SPA
> history-fallback via `setNotFoundHandler`) and would brick the app shell with
> auth off over a tunnel. The design scopes the guard to the sensitive API
> namespaces instead.

- **Promote `networkGuard` to a single universal `onRequest` hook** that runs
  **regardless of whether auth is configured**, with jurisdiction over the
  sensitive HTTP namespaces (`/api/*`, `/v1/*`, `/editor/*`, `/live/*`). Within
  jurisdiction it is deny-by-default; **outside jurisdiction it does nothing** —
  static assets, the SPA shell (`/` + deep-link fallback), `/manifest.json`,
  `/auth/*`, favicon, PWA icons are served as today. (Verified: every dangerous
  route lives under those four namespaces.)
- **In-namespace public exceptions** (reachable unauthenticated within `/api`):
  `/api/health`, `PUBLIC_PAIRING_PREFIXES`, and configured `auth.bypassUrls`.
- **`/v1/*` is authenticated by the model-proxy gate.** That gate SHALL set
  `request.isAuthenticated` on a valid `pi-proxy-*` key so the guard admits it via
  the normal pass condition; the guard registers **last** (after the bearer,
  OAuth, and proxy-gate `onRequest` hooks). No `/v1` public allowlist entry (that
  would be a hole when the proxy is disabled).
- **Preserve every existing pass condition** — loopback / genuine-local,
  trusted-network CIDR, local-token, valid bearer, valid OAuth cookie. The
  intended behavior change is that previously-ungated `/api` sensitive routes
  become guarded when auth is off.
- **Keep WS upgrades on their existing path** — `validateWsUpgrade` + single-use
  scoped ws-ticket, unchanged. The ws-ticket **mint** endpoint is under `/api` and
  stays **guarded** (an authed client mints a ticket; it is not public).
- **Leave the per-route `preHandler: networkGuard` in place** as redundant
  defense-in-depth.
- **Add a namespace-coverage test** asserting no dangerous route sits outside the
  guarded namespaces (preserves the deny-by-default guarantee).
- **Log every denial** (path, source IP, reason) so a probing LAN/tunnel client
  is observable.

Out of scope (tracked separately in `security-boundary-audit/tasks.md`): the
bridge↔server WS authentication (S2), the client XSS trio (S3), the
git-checkout injection (B1), and the individual cwd-allowlist hardening inside
each plugin (defense-in-depth on top of this guard).

## Impact

- **Closes:** VD2 automation-plugin RCE (tunnel, auth-off); provider-auth
  credential read/overwrite + browser-spawn DoS; kb/flows plugin route exposure.
- **Behavior change / risk:** previously-ungated `/api` sensitive routes become
  guarded when auth is off (intended). Residual risks: (a) a future dangerous
  route added *outside* the guarded namespaces would be unguarded — mitigated by
  the namespace-coverage test; (b) the `/v1` proxy-gate ordering + `isAuthenticated`
  wiring must be correct or model-proxy traffic bricks — covered by dedicated
  scenarios. The SPA/login lockout risk of the first draft is eliminated by
  scoping (public surface is out of jurisdiction).
- **Affected specs:** `trusted-networks`, `auth-bypass-url-list`,
  `dashboard-plugin-loader` (plugin routes now inherit the guard). Delta specs to
  be authored in the next artifact step.
- **Affected code:** `packages/server/src/server.ts` (hook registration),
  `packages/server/src/localhost-guard.ts` / `auth-plugin.ts` (allowlist +
  onRequest form of the guard).

## Discipline Skills

- `security-hardening` — this is an auth-boundary change; STRIDE the allowlist and
  the deny-by-default default.
- `doubt-driven-review` — the change is a broad, semi-irreversible enforcement
  flip; stress-test the public-route allowlist for lock-out before it stands.
- `scenario-design` — enumerate the guarded/allowlisted matrix (loopback, LAN
  trusted, tunnel authed, tunnel anon, plugin route, health, manifest, pairing,
  OAuth callback, WS upgrade) as real test scenarios.
- `observability-instrumentation` — denial logging so probes are visible.
