## Why

A standalone SPA on its own origin (an app served from `team.example.com`, not from the
dashboard) must solve the same plumbing every time: read the host's OIDC login
descriptor, run a PKCE sign-in, attach a bearer to every REST call, mint a single-use
`browser`-scope WebSocket ticket, and keep a reconnecting socket alive. InvoiceBot's
finance SPA (`BlackBeltTechnology/invoice-bot-dashboard`, `src/auth/*`,
`src/reconnecting-socket.ts`) already built and tested this layer, but it lives inside a
product repo and hard-wires same-origin `/api` + `/ws`. The upcoming AI Team app
(`add-team-plugin`) needs exactly the same layer, cross-origin. Copying it would create a
second, diverging security-sensitive implementation.

## What Changes

- New publishable workspace library `packages/app-kit`
  (`@blackbelt-technology/pi-dashboard-app-kit`): the product-neutral client plumbing for
  a standalone SPA that talks to a pi-dashboard host.
- Ported from InvoiceBot (same org) and generalised: `authedFetch`, `mintWsTicket`,
  `ticketSocketUrl`, identity state (`getAccessToken`, `currentOperator`,
  `onSessionRefused`), login-descriptor read, `buildOidcConfig`, `IdentityProvider` /
  `useIdentity`, `connectWithReconnect`.
- New: a runtime dashboard endpoint (`loadAppConfig` → `{ dashboardUrl }`) so one static
  build targets any host origin; every URL the kit builds derives from it.
- New: explicit identity modes (`unknown` / `oidc` / `none`); nothing is sent before the
  mode is known; `none` works only where the host admits the caller without a credential
  (loopback, trusted network), a refusal surfaces as `not_admitted`.
- Product-specific pieces are NOT ported: InvoiceBot's `access-me` role read, greeting
  folding, chat fold. Roles stay an app concern.
- No host (server/client) code changes. InvoiceBot's migration onto the kit is out of
  scope (separate repo); the kit's API is kept compatible with its current call sites.

## Capabilities

### New Capabilities
- `standalone-app-kit`: endpoint config, authenticated transport, WS ticket + URL,
  login descriptor, OIDC PKCE config, identity context, reconnecting socket for an SPA
  on a foreign origin.

### Modified Capabilities
- None.

## Impact

- New `packages/app-kit/` (src, tests, README, AGENTS.md). Dependencies: `oidc-client-ts`,
  `react-oidc-context` (versions matching InvoiceBot: `^3.5.0`, `^3.3.1`), `react` as peer.
- Registrations: `.github/workflows/publish.yml` PACKAGES, root `vitest.config.ts`
  projects, `knip.json` workspaces.
- Host requirements (already present, no change): `GET /api/identity/login-config`,
  `POST /api/ws-ticket`, `?ticket=` WS admission, `cors.allowedOrigins`.
- Compatibility: additive. Rollback = remove the package and its registrations.

## Discipline Skills

- `security-hardening` — the kit handles bearer tokens, WS tickets and OIDC config; check
  token never lands in a URL, storage scope, fail-closed paths.
- `doubt-driven-review` — the package is a public API other repos will consume; review the
  surface before it is published.
- `review-code` — inline review before commit.
