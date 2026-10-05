## Context

The host already supports a browser on a foreign origin:

- Login descriptor: `GET /api/identity/login-config` (`packages/server/src/server.ts:1851`)
  returns `{active:false}` or `{active:true, providers, ...BrowserLoginConfig}`
  (`packages/server/src/identity/browser-login-config-registry.ts:129-135`; fields incl.
  `silentSignIn` at `packages/shared/src/identity.ts:136-169`). It is published by an
  identity plugin through `ctx.registerBrowserLoginConfig`
  (`packages/dashboard-plugin-runtime/src/server/server-context.ts:988`).
- WS ticket: `POST /api/ws-ticket` (behind `networkGuard`) body `{scope?}` →
  `{success:true,data:{ticket}}` (`packages/server/src/server.ts:2437-2486`); consumed once
  from `?ticket=` (`packages/server/src/auth/ws-ticket.ts:114-120,181`).
- Cross-origin admission: `cors.allowedOrigins` (`packages/shared/src/config.ts:843`),
  `isCorsOriginAllowed` (`packages/server/src/auth/cors-origin.ts:176`) for `/api` and WS.
  The dashboard's own Host must also be admissible (host-admission: `allowedHosts` /
  `publicBaseUrls`).
- `{active:true}` is also returned for separate-view (`loginUrl`) and dashboard-UI
  (`tokenUrl`) providers that carry no `issuer`/`clientId`
  (`browser-login-config-registry.ts:78-97`); the port guards this
  (`login-descriptor.ts:6-8,45,50`).
- Unauthenticated callers pass `networkGuard` only from loopback, a local token, or a
  trusted network (`packages/server/src/auth/localhost-guard.ts:344-382`). `{active:false}`
  therefore means "no OIDC provider", NOT "no auth": legacy cookie auth and unenforced
  resolvers also answer `{active:false}` (`server.ts:1843-1848`).
- Bearer validation: the Keycloak resolver requires an exact `audience`
  (`packages/keycloak-resolver-plugin/src/server/resolver.ts:92-96`).

InvoiceBot's SPA implements the client side: `transport.ts:46,64,83,94`
(`ticketSocketUrl(wsUrl): string|null|Promise<string|null>`), `identity-state.ts:25-56`,
`identity-context.tsx` (`IdentityProvider` value injector `:65-67`, `OidcIdentityBridge`
`:117-197` coupled to `useAccessMe`), `login-descriptor.ts:38-45` (maps inactive →
`unavailable`), `oidc-config.ts:11,53` (imports `react-oidc-context`),
`reconnecting-socket.ts:27-47,73,109-116,160-163` (`{url, resolveUrl?, createSocket?,
setTimer?, clearTimer?, random?}`; called from `chat-session.ts:89-91`,
`automation-events.ts:122`, `processing-cost-feed.ts:114`).

## Goals / Non-Goals

**Goals:** one tested, publishable implementation of the standalone-SPA plumbing;
cross-origin capable; transport/socket usable without React; signature-compatible with
InvoiceBot's call sites so it can migrate later.

**Non-Goals:** host changes; product role reads; chat rendering (the workspace-only
`chat-embed` subpath, `packages/client/src/chat-embed/index.ts:10-14`, is never imported);
migrating InvoiceBot.

## Decisions

**D1 — Package shape.** `packages/app-kit`, `@blackbelt-technology/pi-dashboard-app-kit`,
public, ESM, built to `dist/`, explicit `files` (excluding `**/AGENTS.md`,
`**/*.AGENTS.md`), `license`, README. Entries: `.` (framework-free: config, transport,
identity-state, login-descriptor, socket) and `./react` (`oidc-config`,
`OidcIdentityBridge`, `IdentityProvider`, `useIdentity`, `useOptionalIdentity`,
`operatorFromUser`). `oidc-config` sits in `./react` because it uses `react-oidc-context`
types. React is a peer dependency. Alternative rejected: reuse `packages/client`'s
`cross-origin-client` support (`ApiContext`, `openspec/specs/cross-origin-client`); it is
internal to the dashboard client, pairing/token-based, and not publishable. Also rejected:
the neutral shell's `packages/shell/src/lib/connect.ts` (bearer REST + fresh ticket), which
is tied to device pairing, not OIDC; the kit reuses its rules (bearer never in a WS URL,
fresh ticket per connect).

**D2 — Runtime endpoint.** `loadAppConfig(url = "/config.json")` → `{ dashboardUrl? }`.
A JSON object is required; `{"dashboardUrl": ""}` or no `dashboardUrl` means same origin.
A `404`, an HTML body (SPA-fallback servers answer unknown paths with `index.html`), a
network failure or a non-object ⇒ throw `app_config_unavailable`, unless the caller passed
`{ allowMissing: true }` (dev proxy), which maps 404/HTML to same origin. `configureDashboard({ dashboardUrl })` sets it directly.
`apiUrl(path)` / `wsUrl(path)` resolve a relative path with `new URL(path, base)`
(`http→ws`, `https→wss`); an absolute `http(s)`/`ws(s)` URL passes through unchanged, so
InvoiceBot's absolute-URL call sites keep working. Credentials are origin-bound: a bearer
or ticket is attached only when the resolved URL's origin equals the dashboard origin
(`ws(s)` compared as `http(s)`); any other origin gets a plain request / no ticket. Non-http(s) or
userinfo-bearing URLs ⇒ `invalid_dashboard_url`.

**D3 — Identity mode.** Four states: `unknown` (descriptor not yet read), `oidc`
(descriptor active AND carries `issuer` + `clientId`), `none` (descriptor
`{active:false}`), `unavailable` (read failed, malformed, or active without
`issuer`/`clientId`). Only `oidc` and `none` ever send a request. The port's
"inactive → unavailable" mapping is deliberately replaced: `none` is a valid mode, but it
only works where the host admits the caller without a credential (loopback, trusted
network); a `401`/`403` in `none` mode is surfaced as `not_admitted` and never retried as
OIDC. Descriptor read failure ⇒ `unavailable` (stays fail-closed; never `none`).

**D4 — Transport.** `authedFetch(path, init)` resolves via `apiUrl`. `oidc` + token ⇒
`Authorization: Bearer <token>` unless the caller supplied an explicit `Authorization`;
`oidc` + no token, `unknown` or `unavailable` ⇒ throw `NoCredentialError`, nothing sent;
`none` ⇒ plain request (no credential exists, so nothing can leak; a host that still
requires auth answers 401/403 → `not_admitted`). Always `credentials:"omit"`. The bearer is
attached only for the dashboard origin (D2). Every `401` calls `notifySessionRefused()` (port
behaviour; listeners dedupe).

**D5 — WS ticket.** `mintWsTicket("browser")` through `authedFetch`;
`ticketSocketUrl(path)` returns `wsUrl(path)?ticket=<t>`, `null` in `unknown`/`unavailable`
mode or when no ticket can be minted in `oidc` mode, plain `wsUrl` in `none` mode. The bearer never appears in a URL.

**D6 — OIDC.** `buildOidcConfig(descriptor, { redirectUri })`: authority = issuer,
`client_id`, code + PKCE, no secret, `sessionStorage` user store,
`automaticSilentRenew: true` (port behaviour). The descriptor's `silentSignIn` is a
separate-view `prompt=none` property (`packages/shared/src/identity.ts:165-169`) and is
not consulted.

**D7 — Socket.** `connectWithReconnect` keeps the port's options
`{ url, resolveUrl?, onOpen, onMessage, onStatus, maxRetries, baseDelayMs?, maxDelayMs?,
jitterRatio?, createSocket?, setTimer?, clearTimer?, random? }`. `resolveUrl` runs before every attempt (fresh single-use
ticket). `maxRetries` counts retries after the first attempt (cap 3 ⇒ at most 4
attempts, then terminal `disconnected`). `resolveUrl` returning `null` or rejecting ⇒
immediate terminal `disconnected` (no credential: retrying cannot help). Error-then-close
schedules one retry; `close()` never reconnects.

**D8 — Identity React surface.** `OidcIdentityBridge` is ported without `useAccessMe`:
it syncs the OIDC user's access token into identity-state, clears it on sign-out and on
refusal, and exposes `{ operator:{iss,sub}, labels, signInReady, mode, signIn(), signOut() }`. Product roles
come through an optional `resolveRole?: (operator) => Promise<string|null>` prop.
`IdentityProvider` stays the plain value injector (tests and non-OIDC hosts).

**D9 — Provenance.** Ported files carry a header naming their InvoiceBot origin; their
tests are ported, adjusted where D3/D7 change behaviour, and extended.

## Risks / Trade-offs

- [Token in `sessionStorage` readable by XSS] → unchanged vs InvoiceBot; README requires a
  strict CSP.
- [Fork drift until InvoiceBot migrates] → the kit is the source of truth; signature
  compatibility (D7) keeps migration mechanical.
- [Deployment misconfiguration fails as opaque CORS/401] → README prerequisites:
  `cors.allowedOrigins` (app origin), `allowedHosts`/`publicBaseUrls` (dashboard host),
  HTTPS, a public client whose tokens carry the resolver's `audience` (audience mapper)
and that supports silent renew,
  exact redirect URI, an identity plugin publishing the login config.
- [knip export ratchet] → entries declared in `knip.json`; run `knip-ratchet` locally.

## Migration Plan

Additive package. Rollback: delete `packages/app-kit` and its registrations.
