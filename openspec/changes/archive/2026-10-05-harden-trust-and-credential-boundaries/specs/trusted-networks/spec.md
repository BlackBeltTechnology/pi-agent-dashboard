## MODIFIED Requirements

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `isTrustedSource(ip, headers, trustedNetworks)` is `true`, or (d) `request.isAuthenticated` is `true` (set by the auth `onRequest` hook).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"` (replacing the prior human string `"Access denied"`), so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback, not in trustedNetworks, and request not authenticated"`).
- `hint` SHALL describe the remedy (e.g. `"Add this network to trustedNetworks (Settings → Servers) or sign in."`).

The existing `localhostGuard` export SHALL be preserved for backward compatibility.


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: Loopback IP allowed
- **WHEN** `requireLocalProof` is disabled and a request arrives from `127.0.0.1` with no proxy-forwarding header
- **THEN** the guard SHALL allow the request regardless of trustedNetworks or authentication

#### Scenario: Relayed loopback not allowed by loopback alone
- **WHEN** a request arrives from `127.0.0.1` carrying `X-Forwarded-For`, is not authenticated, and carries no local-IPC token
- **THEN** the guard SHALL return 403 `network_not_allowed` even if `trustedNetworks` contains a loopback entry

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (add to `trustedNetworks` or authenticate)

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

### Requirement: Universal guard runs regardless of auth configuration
The universal `onRequest` guard SHALL enforce network policy on in-jurisdiction
routes even when auth is not configured. When `config.authConfig` is absent or its
provider registry is empty, `request.isAuthenticated` SHALL default to `false`
(decorated unconditionally) and the guard SHALL still deny non-loopback,
non-trusted, non-exception in-jurisdiction requests. Enforcement SHALL NOT depend
on the conditional OAuth `onRequest` hook being registered.


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: plugin route denied over tunnel with auth off
- **WHEN** auth is not configured and a proxied/tunneled request (forwarding headers present, so not genuine-local) arrives at `POST /api/plugins/automation/create` from an untrusted IP
- **THEN** the guard SHALL deny the request with 403, write no automation file, and spawn no agent

#### Scenario: provider-auth route denied with auth off
- **WHEN** auth is not configured and an untrusted, unauthenticated request arrives at `PUT /api/provider-auth/api-key`
- **THEN** the guard SHALL deny the request with 403

#### Scenario: loopback allowed with auth off
- **WHEN** `requireLocalProof` is disabled and auth is not configured and a genuine-local loopback request arrives at a guarded route
- **THEN** the guard SHALL allow the request

### Requirement: auth.bypassHosts honored without OAuth providers
The config module SHALL treat `config.auth.bypassHosts` and `config.auth.bypassUrls` as first-class configuration fields that are honored at load time regardless of whether `config.auth.providers` is present or non-empty. Specifically, `loadConfig()` SHALL produce a non-empty `resolvedTrustedNetworks` array whenever `config.auth.bypassHosts` contains entries, even if `config.auth.providers` is `{}` or absent. The existing merge semantics (deduplication, precedence, wildcard/CIDR/exact-IP formats) SHALL continue to apply.

The auth plugin SHALL continue to no-op when `providerRegistry.size === 0`: no OAuth routes registered, no `onRequest` hook installed. Cookie parsing (`@fastify/cookie`) SHALL be registered once at server level, independent of providers, and SHALL NOT by itself authenticate any request. The bypassHosts behaviour SHALL be served entirely through `resolvedTrustedNetworks` and the network guard.

#### Scenario: bypassHosts configured without providers
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and no top-level `trustedNetworks`
- **THEN** `loadConfig()` SHALL return `resolvedTrustedNetworks: ["192.168.1.0/24"]`
- **AND** `config.auth` SHALL NOT be `undefined`
- **AND** `config.auth.bypassHosts` SHALL equal `["192.168.1.0/24"]`

#### Scenario: bypassHosts configured with no auth.providers key at all
- **WHEN** config contains `{ "auth": { "bypassHosts": ["10.0.0.0/8"] } }` with no `providers` key whatsoever
- **THEN** `loadConfig()` SHALL return `resolvedTrustedNetworks: ["10.0.0.0/8"]`

#### Scenario: bypassUrls configured without providers
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassUrls": ["/webhooks/"] } }`
- **THEN** `loadConfig()` SHALL return a populated `config.auth.bypassUrls: ["/webhooks/"]`
- **AND** `config.auth` SHALL NOT be `undefined`

#### Scenario: auth with only empty arrays
- **WHEN** config contains `{ "auth": { "providers": {}, "bypassHosts": [], "bypassUrls": [] } }`
- **THEN** `loadConfig()` MAY return `config.auth` as `undefined` (no auth-relevant content)
- **AND** `resolvedTrustedNetworks` SHALL be an empty array

#### Scenario: bypassHosts merged with top-level trustedNetworks, no providers
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"], "auth": { "providers": {}, "bypassHosts": ["10.0.0.0/8"] } }`
- **THEN** `resolvedTrustedNetworks` SHALL contain both `192.168.1.0/24` and `10.0.0.0/8`
- **AND** the entries SHALL be deduplicated (if the same entry appears in both lists, it appears once in the result)

#### Scenario: Auth plugin stays inactive with bypassHosts-only config
- **WHEN** the server starts with `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }`
- **THEN** no OAuth routes (`/auth/login`, `/auth/callback`, etc.) SHALL be registered
- **AND** the auth plugin SHALL register no cookie plugin of its own (the server-level cookie parser is unaffected)
- **AND** `request.isAuthenticated` SHALL default to `false` for all requests
- **AND** the network guard SHALL still admit requests from `192.168.1.0/24` via `resolvedTrustedNetworks`

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check trusted networks in addition to genuine-local, local-IPC token, ticket and auth. A connection SHALL be allowed without authentication when `isTrustedSource(remoteAddress, headers, trustedNetworks)` is `true`. The `validateWsUpgrade` function SHALL accept the trusted networks list and the upgrade headers and SHALL use `isTrustedSource`.


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

#### Scenario: WebSocket relayed through a loopback tunnel
- **WHEN** a WebSocket upgrade arrives from `127.0.0.1` with `X-Forwarded-For`, no ticket and no auth cookie, and `trustedNetworks` contains `127.0.0.1`
- **THEN** the upgrade SHALL be rejected

### Requirement: Relayed loopback requests are never trusted by network entry
Every decision that admits or exempts a request because its source IP matches `trustedNetworks` / `auth.bypassHosts` SHALL go through a single predicate `isTrustedSource(ip, headers, trusted)` exported from `localhost-guard.ts`. The predicate SHALL return `false` when the socket peer is in the loopback range — any address in `127.0.0.0/8`, `::1`, or IPv4-mapped `::ffff:127.0.0.0/104` (not only the literal `127.0.0.1`) — **and** the request carries any proxy-forwarding header (the core `PROXY_FORWARDING_HEADERS` list used by `isGenuinelyLocal`), regardless of the trusted entries. Otherwise it SHALL return the result of `isBypassedHost(ip, trusted)`.

This applies to: the HTTP network guard and universal hook, the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption.


When `requireLocalProof` is enabled, `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: Tunnel request with loopback trusted entry is denied
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`, auth not configured
- **WHEN** `GET /api/sessions` arrives from peer `127.0.0.1` carrying `X-Forwarded-For: 203.0.113.9`
- **THEN** the response SHALL be 403 with `error: "network_not_allowed"`

#### Scenario: Tunnel request with loopback CIDR or wildcard entry is denied
- **GIVEN** `trustedNetworks` contains `127.0.0.0/8` or `127.*`
- **WHEN** a request arrives from peer `127.0.0.1` carrying `X-Forwarded-Proto: https`
- **THEN** the trusted-network pass condition SHALL NOT admit it

#### Scenario: Relay on a non-canonical loopback address is denied
- **GIVEN** `trustedNetworks` contains `127.0.0.0/8`
- **WHEN** a request arrives from peer `127.0.0.5` (or `::ffff:127.0.0.5`) carrying `X-Forwarded-For`
- **THEN** the trusted-network pass condition SHALL NOT admit it

#### Scenario: OAuth bypass-host skip does not apply to relayed loopback
- **GIVEN** auth is configured and `auth.bypassHosts` contains `127.0.0.1`
- **WHEN** a request arrives from peer `127.0.0.1` carrying `X-Forwarded-For` and no valid session cookie
- **THEN** the auth hook SHALL NOT skip authentication

#### Scenario: WebSocket upgrade through a tunnel is not trusted by loopback entry
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`
- **WHEN** a `/ws` upgrade arrives from peer `127.0.0.1` with `X-Forwarded-For` and no valid ticket or cookie
- **THEN** the upgrade SHALL be rejected (401 when auth is configured, 403 otherwise)

#### Scenario: Paired device over a tunnel still works
- **GIVEN** `trustedNetworks: ["127.0.0.1"]`
- **WHEN** a request arrives from peer `127.0.0.1` with `X-Forwarded-For` and a valid device bearer
- **THEN** the request SHALL be admitted via `isAuthenticated` and device-tier checks SHALL apply (no trusted-network tier exemption)

#### Scenario: Genuine local request unaffected
- **WHEN** `requireLocalProof` is disabled and a request arrives from peer `127.0.0.1` with no forwarding header
- **THEN** it SHALL be admitted by the genuine-local condition, independent of `trustedNetworks`

#### Scenario: LAN trusted CIDR unaffected
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request arrives from peer `192.168.16.20`, with or without forwarding headers
- **THEN** the trusted-network pass condition SHALL admit it

### Requirement: WebSocket upgrade admits bypassHosts trust without OAuth
The WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed.


When `requireLocalProof` is enabled, `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols)
- **AND** the connection SHALL NOT be rejected with 403 or 401

#### Scenario: WebSocket upgrade from untrusted IP in bypassHosts-only config
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `10.0.0.5` (not in trusted list)
- **THEN** the upgrade SHALL be rejected with 403
