## Purpose
Network access policy for guarded endpoints: an allow-list (CIDR/wildcard/exact) that, with loopback and authenticated requests, governs the network guard.

## Requirements

### Requirement: Top-level trustedNetworks config field
The config module SHALL support a top-level `trustedNetworks` field of type `string[]` in `~/.pi/dashboard/config.json`. Each entry SHALL be an IPv4 CIDR (e.g. `192.168.1.0/24`), wildcard (e.g. `10.0.0.*`), or exact IP address. The default SHALL be an empty array. At load time, the config module SHALL merge `trustedNetworks` with `auth.bypassHosts` (if present) into a single deduplicated list available as `resolvedTrustedNetworks` on the config object.

#### Scenario: trustedNetworks configured without auth
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"] }` and no `auth` section
- **THEN** `loadConfig()` SHALL return `trustedNetworks: ["192.168.1.0/24"]` and `resolvedTrustedNetworks: ["192.168.1.0/24"]`

#### Scenario: trustedNetworks merged with auth.bypassHosts
- **WHEN** config contains `{ "trustedNetworks": ["192.168.1.0/24"], "auth": { "bypassHosts": ["10.0.0.0/8"] } }`
- **THEN** `resolvedTrustedNetworks` SHALL contain both `192.168.1.0/24` and `10.0.0.0/8`

#### Scenario: Duplicate entries deduplicated
- **WHEN** both `trustedNetworks` and `auth.bypassHosts` contain `192.168.1.0/24`
- **THEN** `resolvedTrustedNetworks` SHALL contain the entry only once

#### Scenario: Neither configured
- **WHEN** config has no `trustedNetworks` field and no `auth.bypassHosts`
- **THEN** `resolvedTrustedNetworks` SHALL be an empty array

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `request.isAuthenticated` is `true` (set by the auth `onRequest` hooks), or (d) **only when the effective trust mode is `"legacy"`**, `isTrustedSource(ip, headers, trustedNetworks)` is `true`. Condition (c) SHALL be evaluated before (d).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"`, so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback and request not authenticated"`).
- `hint` SHALL describe the remedy: pairing this device (Request access) or signing in. It SHALL be identical in both trust modes (the body is sent to credential-less callers and SHALL NOT disclose the mode) and SHALL NOT suggest adding the network to a trusted list.

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Loopback IP allowed
- **WHEN** `requireLocalProof` is disabled and a request arrives from `127.0.0.1` with no proxy-forwarding header
- **THEN** the guard SHALL allow the request regardless of trustedNetworks, trust mode or authentication

#### Scenario: Relayed loopback not allowed by loopback alone
- **WHEN** a request arrives from `127.0.0.1` carrying `X-Forwarded-For`, is not authenticated, and carries no local-IPC token
- **THEN** the guard SHALL return 403 `network_not_allowed` even if `trustedNetworks` contains a loopback entry

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (pair this device or sign in)

#### Scenario: Hint does not disclose the mode
- **WHEN** the guard denies the same request once in `"pair"` mode and once in `"legacy"` mode
- **THEN** both bodies SHALL be identical
- **AND** neither `hint` SHALL mention adding the network to `trustedNetworks`

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

### Requirement: Network guard threaded to all protected routes
The network guard SHALL be enforced as a single universal Fastify `onRequest`
hook whose jurisdiction is the sensitive HTTP namespaces (`/api/*`, `/v1/*`,
`/editor/*`, `/live/*`), installed once at startup and running regardless of
whether `config.authConfig` is present. Within jurisdiction the guard SHALL
deny-by-default: a request is allowed only if it satisfies a pass condition or an
in-namespace public exception. This replaces reliance on per-route
`preHandler: networkGuard` opt-in as the primary enforcement mechanism.
Route files SHALL continue to receive the guard via their `RouteDeps`
`networkGuard` field (created once at startup over the live admission-list thunk);
that threading remains valid but is no longer the protection boundary.

Jurisdiction and in-namespace exception matching SHALL operate on the parsed
request **pathname** (query string and fragment stripped), with prefix matches
anchored on a trailing slash, so neither a query string (`/api/health?x=1`) nor a
near-miss prefix (`/apiv2`, `/api/healthz`) changes the decision.

The guard SHALL be registered as the **last** `onRequest` hook unconditionally —
after the host gate, CORS, the mutation-origin gate, CSP, `registerBearerAuth`,
`registerAuthPlugin` (when configured), the live-preview capability hook, the route-tier gate, and the model-proxy
auth gate (when configured) — so `request.isAuthenticated` reflects every auth
source when the guard evaluates. "Last" SHALL NOT be expressed relative to a
conditional hook.

The guard SHALL read the admission list (the trusted-network set in `"legacy"`
mode, empty in `"pair"` mode) through the live thunk, never a boot snapshot, so a
CIDR added at runtime in `"legacy"` mode admits without a restart and a switch to
`"pair"` mode stops admitting without a restart.

A denial by the universal guard SHALL preserve the existing denial contract: the
`network_not_allowed` response body clients branch on, and the `blockEvents`
recording that feeds `GET /api/tunnel/block-events`. Core route registrations MAY retain their existing
`preHandler: networkGuard` as redundant defense-in-depth; these SHALL NOT be
required for a route to be protected.

#### Scenario: sensitive route protected by the universal hook alone
- **WHEN** the per-route `preHandler` is absent but the universal hook is installed, and a request to `POST /api/sessions/:id/prompt` arrives from an untrusted, unauthenticated IP
- **THEN** the request SHALL be denied by the universal hook (403)

#### Scenario: retained per-route guard is harmless
- **WHEN** a core route still declares `preHandler: networkGuard` and the universal hook is installed
- **THEN** the request SHALL be evaluated consistently (both agree) and SHALL NOT be double-rejected or error

#### Scenario: denial keeps the existing response contract
- **WHEN** the universal hook denies an in-jurisdiction request
- **THEN** the response body SHALL be the existing `network_not_allowed` shape
- **AND** the denial SHALL be recorded in the `blockEvents` buffer exposed by `GET /api/tunnel/block-events`

#### Scenario: runtime-added trusted CIDR admits without restart
- **WHEN** the effective trust mode is `"legacy"`, a CIDR is added to the trusted-network set while the server is running, and a request arrives from that network
- **THEN** the guard SHALL allow it without a restart

#### Scenario: Session route uses network guard
- **WHEN** the effective trust mode is `"legacy"` and a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: Session route denies a listed peer in pair mode
- **WHEN** the effective trust mode is `"pair"` and an unauthenticated request to `POST /api/sessions/:id/prompt` arrives from a listed network IP
- **THEN** the route SHALL return 403

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check genuine-local, local-IPC token, ticket and auth, and — **only when the effective trust mode is `"legacy"`** — trusted networks. When the identity floor requires a principal-bearing ticket for the upgrade's scope, that rule SHALL take precedence over every allowance in this requirement, in both modes. In `"legacy"` mode a connection SHALL be allowed without authentication when `isTrustedSource(remoteAddress, headers, trustedNetworks)` is `true`; credential checks (ticket, cookie) SHALL be evaluated before this network match. The `validateWsUpgrade` function SHALL accept the admission list and the upgrade headers and SHALL use `isTrustedSource`.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** the identity floor is not enforced, the effective trust mode is `"legacy"`, and a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from listed network without auth in pair mode
- **WHEN** the effective trust mode is `"pair"` and a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]`, no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

#### Scenario: WebSocket relayed through a loopback tunnel
- **WHEN** a WebSocket upgrade arrives from `127.0.0.1` with `X-Forwarded-For`, no ticket and no auth cookie, and `trustedNetworks` contains `127.0.0.1`
- **THEN** the upgrade SHALL be rejected

### Requirement: Auth hook tags authenticated requests
The auth plugin SHALL use `fastify.decorateRequest('isAuthenticated', false)` at registration time. When the `onRequest` hook verifies a valid JWT cookie, it SHALL set `request.isAuthenticated = true` before returning. When auth is not configured, `server.ts` SHALL register the `isAuthenticated` decorator with a default of `false` so the guard can safely read it in all cases.

#### Scenario: Valid JWT sets isAuthenticated
- **WHEN** auth is configured and a request arrives with a valid JWT cookie
- **THEN** the auth hook SHALL set `request.isAuthenticated = true`

#### Scenario: No auth configured
- **WHEN** auth is not configured
- **THEN** `request.isAuthenticated` SHALL be `false` (default decorator value)

#### Scenario: Invalid JWT
- **WHEN** auth is configured and a request arrives with an expired or invalid JWT
- **THEN** `request.isAuthenticated` SHALL remain `false`

### Requirement: Auth plugin reads merged trusted networks
**Only when the effective trust mode is `"legacy"`**, and only after a presented session cookie has been validated (a valid session SHALL authenticate the request as such), the auth plugin `onRequest` hook SHALL skip authentication for requests for which `isTrustedSource(request.ip, request.headers, resolvedTrustedNetworks)` is `true` (the merged list, read live per request). In `"pair"` mode the hook SHALL NOT skip authentication on a network match. A loopback-range peer carrying a proxy-forwarding header SHALL NOT skip authentication in either mode.

#### Scenario: Auth bypassed for trusted network IP
- **WHEN** the effective trust mode is `"legacy"`, auth is configured and a request arrives from an IP in `resolvedTrustedNetworks` without being a relayed loopback request
- **THEN** the auth hook SHALL skip authentication for that request

#### Scenario: Auth required for listed IP in pair mode
- **WHEN** the effective trust mode is `"pair"`, auth is configured and a request arrives from an IP in `resolvedTrustedNetworks` with no session cookie
- **THEN** the auth hook SHALL require authentication

#### Scenario: Auth not bypassed for relayed loopback
- **WHEN** auth is configured, `resolvedTrustedNetworks` contains `127.0.0.1`, and a request arrives from `127.0.0.1` with `X-Forwarded-For`
- **THEN** the auth hook SHALL require authentication

### Requirement: isBypassedHost extracted to localhost-guard module
The `isBypassedHost()`, `matchCidr()`, and `ipToNum()` functions SHALL be moved from `auth-plugin.ts` to `localhost-guard.ts` and exported. The `auth-plugin.ts` SHALL import `isBypassedHost` from `localhost-guard.ts`.

#### Scenario: Auth plugin imports from localhost-guard
- **WHEN** the auth plugin needs CIDR matching
- **THEN** it SHALL import `isBypassedHost` from `localhost-guard.ts`

### Requirement: Network interfaces API endpoint
The server SHALL expose `GET /api/network-interfaces` as a localhost-only endpoint. It SHALL return `{ success: true, data: [...] }` where `data` is an array of detected non-internal IPv4 network interfaces. Each entry SHALL include `name` (interface name), `address` (IPv4 address), `netmask`, and `cidr` (computed CIDR notation, e.g. `192.168.1.0/24`). The CIDR SHALL be computed from the address and netmask.

The endpoint SHALL return **one entry per detected address** and SHALL NOT drop or merge entries. It has two consumers with opposing needs: the listen-interface picker requires every distinct bind address to remain selectable, while the trusted-networks dropdown wants one offer per range. Deduplication is therefore a **presentation** concern owned by the consumer, never by the endpoint.

Each entry SHALL additionally include:
- `label` — a human-meaningful name for the interface, used in place of the raw device name in the UI. A device carrying an address in `100.64.0.0/10` SHALL be labelled as a tailnet interface. When no meaningful label can be derived, `label` SHALL fall back to the device `name`, so the field is always populated.
- `pointToPoint` — `true` when the netmask is `255.255.255.255`. This is a netmask-derived flag, not an interrogation of the OS point-to-point interface flag; any `/32`-configured interface SHALL be treated the same way. A `/32` `cidr` matches exactly one address — the host itself — so it SHALL NOT be presented as a trustable network without a wider alternative.
- `suggestions` — the trust entries offered for this interface, each `{ value, label, wide }`, derived from the same well-known-range table as the block-event trust banner so the two paths never disagree about **which range** contains an address. They may still differ on the `wide` tier, which is contextual — see the `settings-panel` capability. For a non-point-to-point interface the netmask-derived `cidr` SHALL be the sole suggestion, marked `wide: false`. For a point-to-point interface the netmask-derived network is a single address, so the containing well-known range SHALL be offered and SHALL be marked `wide: true`, because it is broader than the interface's own network.

#### Scenario: Machine with Wi-Fi and Ethernet
- **WHEN** the machine has `en0` at `192.168.1.100/255.255.255.0` and `en7` at `10.0.0.50/255.255.0.0`
- **THEN** the endpoint SHALL return entries with `cidr: "192.168.1.0/24"` and `cidr: "10.0.0.0/16"`
- **AND** each SHALL carry a single narrow suggestion equal to its own `cidr`

#### Scenario: Remote request to endpoint
- **WHEN** a request to `GET /api/network-interfaces` arrives from a non-loopback IP
- **THEN** the server SHALL return 403

#### Scenario: Tailscale point-to-point interface is not offered as itself
- **GIVEN** the machine has `utun4` at `100.97.246.31` with netmask `255.255.255.255`
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL NOT offer `100.97.246.31/32` as a trustable suggestion
- **AND** it SHALL offer `100.64.0.0/10` as a wide suggestion
- **AND** its `label` SHALL identify it as a tailnet interface rather than `utun4`

#### Scenario: WireGuard point-to-point interface behaves the same
- **GIVEN** the machine has a `/32` interface whose address is in a well-known private range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** its suggestion SHALL be the containing range, marked wide

#### Scenario: Point-to-point address outside any well-known range
- **GIVEN** the machine has a `/32` interface whose address falls in no well-known private or CGNAT range
- **WHEN** the endpoint is called
- **THEN** the entry SHALL have `pointToPoint: true`
- **AND** it SHALL offer no suggestion, because no truthful range can be derived

#### Scenario: Endpoint keeps every address so the picker stays complete
- **GIVEN** the machine has `en0` at `192.168.10.123/255.255.255.0` and `en7` at `192.168.10.224/255.255.255.0`
- **WHEN** the endpoint is called
- **THEN** it SHALL return two entries, one per address
- **AND** both `192.168.10.123` and `192.168.10.224` SHALL remain selectable as specific bind addresses

#### Scenario: Label falls back to the device name
- **GIVEN** an interface whose address matches no well-known range
- **WHEN** the endpoint is called
- **THEN** its `label` SHALL equal its device `name`

#### Scenario: Range table agrees across both paths
- **GIVEN** an address in `100.64.0.0/10` on a `/32` point-to-point interface
- **WHEN** the containing range is derived for it from the interface AND from a block event
- **THEN** both SHALL name `100.64.0.0/10`

#### Scenario: Malformed trusted entry is ignored, never offered
- **GIVEN** a stored trusted entry that parses as neither exact IP, wildcard, nor CIDR
- **WHEN** suggestions and the reachability predicate are computed
- **THEN** the entry SHALL be skipped rather than reported unreachable or offered

### Requirement: Canonical UI write path is auth.bypassHosts
The top-level `config.trustedNetworks` field SHALL remain readable and SHALL continue to be merged into `resolvedTrustedNetworks` for backward compatibility with hand-edited `config.json` files. However, UI-driven additions to the trusted-networks list SHALL be written to `config.auth.bypassHosts` only. The UI SHALL NOT write new entries to top-level `config.trustedNetworks` and SHALL NOT remove existing entries from top-level `config.trustedNetworks`. The Settings-panel UI behavior for this section is specified by the `settings-panel` capability (see `Trusted Networks section on Security tab`).

#### Scenario: UI write flows to auth.bypassHosts
- **WHEN** a user adds a trusted network via the Settings UI
- **THEN** the resulting config write SHALL place the entry under `auth.bypassHosts`
- **AND** the resulting config write SHALL NOT modify top-level `trustedNetworks`

#### Scenario: Existing top-level trustedNetworks preserved
- **WHEN** `config.json` contains entries in top-level `trustedNetworks` prior to any UI interaction
- **THEN** those entries SHALL continue to load into `resolvedTrustedNetworks` via the existing merge
- **AND** those entries SHALL NOT be removed or migrated by UI operations

#### Scenario: UI removal targets auth.bypassHosts only
- **WHEN** a user removes an entry via the Settings UI and that entry exists in both `auth.bypassHosts` and top-level `trustedNetworks`
- **THEN** the UI SHALL remove the entry from `auth.bypassHosts` only
- **AND** the entry SHALL remain in top-level `trustedNetworks`
- **AND** the entry SHALL still be honored at runtime via the merge into `resolvedTrustedNetworks`

### Requirement: auth.bypassHosts honored without OAuth providers
The config module SHALL treat `config.auth.bypassHosts` and `config.auth.bypassUrls` as first-class configuration fields that are honored at load time regardless of whether `config.auth.providers` is present or non-empty. Specifically, `loadConfig()` SHALL produce a non-empty `resolvedTrustedNetworks` array whenever `config.auth.bypassHosts` contains entries, even if `config.auth.providers` is `{}` or absent. The existing merge semantics (deduplication, precedence, wildcard/CIDR/exact-IP formats) SHALL continue to apply.

The auth plugin SHALL continue to no-op when `providerRegistry.size === 0`: no OAuth routes registered, no `onRequest` hook installed. Cookie parsing (`@fastify/cookie`) SHALL be registered once at server level, independent of providers, and SHALL NOT by itself authenticate any request. The bypassHosts behaviour SHALL be served entirely through `resolvedTrustedNetworks` and the network guard, and SHALL admit by network match only in `"legacy"` trust mode.

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
- **WHEN** the server starts with `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and no `network.trustMode`
- **THEN** no OAuth routes (`/auth/login`, `/auth/callback`, etc.) SHALL be registered
- **AND** the auth plugin SHALL register no cookie plugin of its own (the server-level cookie parser is unaffected)
- **AND** `request.isAuthenticated` SHALL default to `false` for all requests
- **AND** the effective trust mode SHALL be `"legacy"` and the network guard SHALL still admit requests from `192.168.1.0/24` via `resolvedTrustedNetworks`

### Requirement: WebSocket upgrade admits bypassHosts trust without OAuth
**Only when the effective trust mode is `"legacy"`**, the WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty and the mode is `"legacy"`, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed. In `"pair"` mode the IP match SHALL NOT be sufficient.

When `requireLocalProof` is in effect (the default: absent or `true`), `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token, local credential proof, or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` (effective mode `"legacy"`) and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols)
- **AND** the connection SHALL NOT be rejected with 403 or 401

#### Scenario: WebSocket upgrade from listed network in pair mode
- **WHEN** config is `{ "network": { "trustMode": "pair" }, "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no ticket and no auth cookie
- **THEN** the upgrade SHALL be rejected with 403

#### Scenario: WebSocket upgrade from untrusted IP in bypassHosts-only config
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `10.0.0.5` (not in trusted list)
- **THEN** the upgrade SHALL be rejected with 403

### Requirement: Universal guard runs regardless of auth configuration
The universal `onRequest` guard SHALL enforce network policy on in-jurisdiction
routes even when auth is not configured. When `config.authConfig` is absent or its
provider registry is empty, `request.isAuthenticated` SHALL default to `false`
(decorated unconditionally) and the guard SHALL still deny non-loopback,
non-trusted, non-exception in-jurisdiction requests. Enforcement SHALL NOT depend
on the conditional OAuth `onRequest` hook being registered.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: plugin route denied over tunnel with auth off
- **WHEN** auth is not configured and a proxied/tunneled request (forwarding headers present, so not genuine-local) arrives at `POST /api/plugins/automation/create` from an untrusted IP
- **THEN** the guard SHALL deny the request with 403, write no automation file, and spawn no agent

#### Scenario: provider-auth route denied with auth off
- **WHEN** auth is not configured and an untrusted, unauthenticated request arrives at `PUT /api/provider-auth/api-key`
- **THEN** the guard SHALL deny the request with 403

#### Scenario: loopback allowed with auth off
- **WHEN** `requireLocalProof` is disabled and auth is not configured and a genuine-local loopback request arrives at a guarded route
- **THEN** the guard SHALL allow the request

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, and configured `auth.bypassUrls` prefixes. All
other in-jurisdiction requests SHALL require a pass condition (loopback /
genuine-local, local-IPC token, `isAuthenticated`, or — in `"legacy"` trust mode
only — a trusted-network IP).

#### Scenario: health endpoint reachable unauthenticated
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health`
- **THEN** the guard SHALL allow it

#### Scenario: pairing bootstrap reachable unauthenticated
- **WHEN** an unauthenticated request arrives at a `PUBLIC_PAIRING_PREFIXES` path (e.g. `/api/pair/redeem`)
- **THEN** the guard SHALL allow it

#### Scenario: query string does not defeat an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health?probe=1`
- **THEN** the guard SHALL allow it (matching is on the pathname, not the raw URL)

#### Scenario: near-miss path is not treated as an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/healthz`
- **THEN** the guard SHALL deny it (exception matching is anchored, not a loose prefix)

#### Scenario: HEAD health check allowed
- **WHEN** an unauthenticated, untrusted `HEAD /api/health` request arrives
- **THEN** the guard SHALL allow it (the exception is not GET-only)

#### Scenario: unparseable URL fails closed
- **WHEN** a request arrives whose URL cannot be parsed into a pathname
- **THEN** the guard SHALL treat it as in-jurisdiction and deny it

#### Scenario: ws-ticket mint requires a pass condition
- **WHEN** an unauthenticated, untrusted request arrives at the `/api` ws-ticket mint endpoint
- **THEN** the guard SHALL deny it (the mint is not public)

### Requirement: Guard jurisdiction and exceptions are evaluated on BOTH views of the target
The guard SHALL derive two views of every request target and SHALL use BOTH:

- the **raw** view — the percent-decoded request target with query string and
  fragment stripped, dot-segments UNRESOLVED; and
- the **resolved** view — the same pathname with `.` / `..` segments resolved per
  RFC 3986.

A request SHALL be treated as **in jurisdiction** when EITHER view lies inside a
jurisdiction namespace. An in-namespace public exception SHALL be granted only
when it holds on **BOTH** views. A target that cannot be parsed into a pathname
(malformed percent-escape, or an authority-form / absolute-form target) SHALL be
treated as in-jurisdiction and denied.

Both rules are load-bearing; neither is redundant, because the router and the
guard disagree about dot-segments. Fastify passes `onRequest` the RAW target and
find-my-way does not resolve dot-segments — it matches them into a `:param` or
`*` slot as a literal value.

- Deciding on the resolved view ALONE would let `/api/provider-auth/..` reach
  `/api/provider-auth/:provider` with `provider = ".."`, because the resolved
  pathname is `/api`, which is not inside `/api/` under trailing-slash anchoring.
- Deciding on the raw view ALONE would treat `/foo/../api/x` as out of
  jurisdiction, although the same target resolves into `/api/x`.
- Judging an exception on ONE view would let
  `/live/<id>/../../api/pair/challenge` be admitted as the pairing exception while
  the router matches the RAW path into `/live/:id/*` and runs the live proxy with
  an attacker-chosen sub-path.

This union SHALL NOT be replaced by a blanket "deny any target containing a
dot-segment" rule: a dotted target that is out of jurisdiction under BOTH views
(e.g. `/foo/../settings`, the SPA deep-link fallback) SHALL remain a no-op, so
"outside jurisdiction the guard does nothing" continues to hold.

#### Scenario: dotted target that resolves INTO a guarded namespace is denied
- **WHEN** an unauthenticated, untrusted request arrives at `/foo/../api/sessions`
- **THEN** the guard SHALL deny it (the resolved view is in jurisdiction)

#### Scenario: dotted target that resolves OUT of a guarded namespace is denied
- **WHEN** an unauthenticated, untrusted request arrives at `/api/provider-auth/..` or `/live/x/../..`, which the router matches into a `:param` / `*` slot
- **THEN** the guard SHALL deny it (the raw view is in jurisdiction)
- **AND** the route handler SHALL NOT run

#### Scenario: a public exception cannot be smuggled through a wildcard route
- **WHEN** an unauthenticated, untrusted request arrives at `/live/<id>/../../api/pair/challenge`, whose resolved view is the public pairing path while its raw view matches `/live/:id/*`
- **THEN** the guard SHALL deny it (the exception does not hold on both views)

#### Scenario: an encoded namespace prefix is still in jurisdiction
- **WHEN** an unauthenticated, untrusted request arrives at `/%61pi/sessions`
- **THEN** the guard SHALL deny it (the raw view percent-decodes into `/api/`)

#### Scenario: a dotted target outside both views stays a no-op
- **WHEN** an unauthenticated request arrives at `/foo/../settings`
- **THEN** the guard SHALL NOT deny it on network policy (the SPA fallback serves it)

### Requirement: Non-API surfaces are not guarded
The guard SHALL NOT act on requests outside its jurisdiction namespaces, so the
app shell, static assets, `/manifest.json`, `/auth/*`, favicon, and PWA icons
remain reachable exactly as before this change. In particular the SPA index
(served at `/`) and SPA deep-link paths (served via `setNotFoundHandler`) SHALL
remain reachable unauthenticated.

#### Scenario: app shell loads with auth off over a tunnel
- **WHEN** auth is not configured and an unauthenticated tunnel request arrives at `GET /`
- **THEN** the SPA index SHALL be served (not denied)

#### Scenario: deep-link refresh loads
- **WHEN** an unauthenticated request arrives at a SPA deep-link path (e.g. `GET /settings`) served by the not-found fallback
- **THEN** the SPA index SHALL be served

#### Scenario: auth status probe reachable
- **WHEN** an unauthenticated client requests `GET /auth/status`
- **THEN** it SHALL be served (so the client can detect whether auth is enabled)

### Requirement: v1 model-proxy traffic authenticated via the proxy gate
The model-proxy auth gate SHALL set `request.isAuthenticated` to `true` upon
successful validation of a `pi-proxy-*` API key, so the universal guard admits
authenticated `/v1/*` traffic via the standard `isAuthenticated` pass condition.
There SHALL be no public allowlist entry for `/v1/*`; a `/v1/*` request without a
valid proxy key SHALL be rejected (by the proxy gate or the guard).

#### Scenario: valid proxy key passes
- **WHEN** a `/v1/messages` request presents a valid `pi-proxy-*` key
- **THEN** the proxy gate SHALL mark it authenticated and the guard SHALL allow it

#### Scenario: missing proxy key denied
- **WHEN** a `/v1/models` request arrives with no valid credential from an untrusted IP
- **THEN** the request SHALL be rejected (not silently allowed)

#### Scenario: proxy disabled leaves no v1 bypass
- **WHEN** the model proxy is disabled and an untrusted `/v1/*` request arrives
- **THEN** it SHALL NOT be admitted by any public `/v1` bypass

### Requirement: CORS preflight is not denied by the guard
The guard SHALL NOT break cross-origin preflight: `OPTIONS` preflight requests
SHALL continue to be answered by the CORS layer (registered before the guard) and
SHALL NOT be rejected with a network-policy 403.

#### Scenario: preflight to a guarded route succeeds
- **WHEN** a browser sends an `OPTIONS` preflight for `POST /api/sessions` from an allowed origin
- **THEN** the CORS layer SHALL answer it and the guard SHALL NOT deny it

### Requirement: No dangerous route outside the guarded namespaces
The codebase SHALL keep every dangerous (non-public, non-static, non-auth) HTTP
route under a guarded jurisdiction namespace (`/api`, `/v1`, `/editor`, `/live`)
or inside an **explicitly enumerated independently-authenticated namespace**,
verified by a test with plugin routes loaded, so a route added outside those
prefixes cannot silently bypass the guard.

The independently-authenticated set SHALL contain `/mcp` (which authenticates
in-handler via the paired-device token registry and deliberately does not trust
`request.isAuthenticated`). The static-allow set SHALL contain `/sw.js`. Adding a
namespace to either set SHALL be an explicit code change, not an implicit
fall-through. No client-side SPA route SHALL live under a guarded namespace,
since an unmatched in-jurisdiction path is denied rather than falling through to
the SPA handler.

#### Scenario: namespace-coverage test
- **WHEN** the route table is enumerated in a test with plugin routes registered
- **THEN** every non-static, non-`/auth`, non-public route SHALL resolve under a guarded namespace or an enumerated independently-authenticated namespace, else the test SHALL fail

#### Scenario: /mcp is enumerated, not ignored
- **WHEN** the coverage test encounters a `/mcp*` route
- **THEN** it SHALL pass only via the explicit independently-authenticated entry
- **AND** a test SHALL assert every `/mcp*` route (including the bare `/mcp`) requires the plugin's own device-token auth

#### Scenario: no SPA route under a guarded namespace
- **WHEN** the client route table is enumerated
- **THEN** no client-side route SHALL start with `/api/`, `/v1/`, `/editor/`, or `/live/`

### Requirement: Model-proxy second port stays loopback-bound or guarded
The optional model-proxy second-port Fastify instance SHALL bind to loopback
(`127.0.0.1`) only, and this SHALL be asserted by a test, so its `/v1/*` surface
(which runs only the proxy auth gate, not the universal guard) is never exposed
beyond loopback. If the second-port bind is ever made configurable beyond
loopback, the universal guard SHALL be installed on that instance too.

#### Scenario: second port binds loopback
- **WHEN** the model-proxy second port is enabled
- **THEN** it SHALL listen on `127.0.0.1` only, asserted by a test

#### Scenario: configurable bind requires the guard
- **WHEN** the second-port bind is changed to a non-loopback host
- **THEN** the universal guard SHALL be present on that instance (else the configuration SHALL be rejected)

### Requirement: Guard denials are logged
Each denial by the universal guard SHALL emit a structured log line including the
request path, source IP, and denial reason, so a probing LAN or tunnel client is
observable. The log line SHALL NOT include request bodies or secrets.

#### Scenario: denied request is logged
- **WHEN** the guard denies a request from `203.0.113.5` to `/api/sessions`
- **THEN** a log line SHALL record the path, source IP, and a reason
- **AND** it SHALL NOT contain the request body or any token

### Requirement: Trusted networks are reviewable and revocable from Access settings

Every configured trusted network SHALL be listed in `Settings → Access` and SHALL offer a revoke action that removes it through the existing configuration write path. The list SHALL be labelled according to the effective trust mode: in `"legacy"` mode as networks admitted without sign-in; in `"pair"` mode as networks that **may request access** (knock eligibility), with no wording that implies they are admitted.

#### Scenario: Configured entries are listed

- **WHEN** the Access page is opened and trusted networks are configured
- **THEN** each entry SHALL be listed with its CIDR, wildcard, or exact host value

#### Scenario: Pair-mode label

- **WHEN** the Access page is opened and the effective trust mode is `"pair"`
- **THEN** the list SHALL be described as networks that may request access, not as trusted or admitted networks

#### Scenario: Revoking removes the entry

- **WHEN** a trusted-network entry is revoked from the Access page
- **THEN** it SHALL be removed from configuration via the existing write path

#### Scenario: Revocation takes effect without restart

- **GIVEN** the guard reads trusted networks through the live configuration snapshot and the effective trust mode is `"legacy"`
- **WHEN** an entry is revoked
- **THEN** a subsequent request from that peer SHALL be denied without a server restart

### Requirement: Trust is acquirable by accepting a pending access request

**Only when the effective trust mode is `"legacy"`**, a trusted network entry SHALL be addable by accepting a pending access request derived from a recorded denial, in addition to the existing tunnel banner and settings paths. Acceptance SHALL be available only for entries classified as trustable. In `"pair"` mode no accept-to-trust action SHALL be offered for a pending network access request; the denied device is directed to pairing instead.

#### Scenario: Accepting a pending request adds trust

- **WHEN** the effective trust mode is `"legacy"` and a trusted client accepts a pending access request for a trustable peer
- **THEN** that peer SHALL be added to trusted networks

#### Scenario: No accept-to-trust in pair mode

- **WHEN** the effective trust mode is `"pair"` and a pending network access request is shown
- **THEN** no action that adds the peer to trusted networks SHALL be offered

#### Scenario: Loopback or proxied peer cannot be accepted

- **WHEN** a pending access request is classified non-trustable
- **THEN** no accept action SHALL be offered, so trusting an entire tunnel is not possible through this path

### Requirement: A network denial may be answered by prompt

**Only when the effective trust mode is `"legacy"`**, a recorded network denial
MAY raise a dialog naming the denied source. An allow-always verdict SHALL add the
corresponding entry to the trusted-networks configuration; an allow-once verdict
SHALL NOT be offered on this plane, because the denied request is never suspended
and there is nothing to allow once.

In `"pair"` mode a network denial SHALL still be recorded in the block-event
buffer but SHALL NOT raise a network-plane grant prompt; the operator is instead
prompted only when the denied device knocks (the pairing approval dialog of the
`lan-knock-pairing` capability).

#### Scenario: Allow always trusts the source

- **WHEN** the effective trust mode is `"legacy"` and an operator answers allow-always on a network denial
- **THEN** the trusted-networks configuration SHALL gain the entry
- **AND** the source's next attempt SHALL be admitted

#### Scenario: Allow once is not offered

- **WHEN** a dialog is raised for a network denial
- **THEN** it SHALL offer only allow-always and deny

#### Scenario: No network grant prompt in pair mode

- **GIVEN** grant prompting is enabled, an operator channel is connected, and the effective trust mode is `"pair"`
- **WHEN** a request from `192.168.16.30` is denied by the network guard
- **THEN** the block event SHALL be recorded
- **AND** no network-plane grant prompt SHALL be raised

#### Scenario: The entry is revocable

- **WHEN** an entry added by a verdict is revoked from the Access surface
- **THEN** the source SHALL be denied again

### Requirement: Relayed loopback requests are never trusted by network entry
Every decision that admits or exempts a request because its source IP matches `trustedNetworks` / `auth.bypassHosts` SHALL go through a single predicate `isTrustedSource(ip, headers, trusted)` exported from `localhost-guard.ts`. The predicate SHALL return `false` when the socket peer is in the loopback range — any address in `127.0.0.0/8`, `::1`, or IPv4-mapped `::ffff:127.0.0.0/104` (not only the literal `127.0.0.1`) — **and** the request carries any proxy-forwarding header (the core `PROXY_FORWARDING_HEADERS` list used by `isGenuinelyLocal`), regardless of the trusted entries. Otherwise it SHALL return the result of `isBypassedHost(ip, trusted)`.

This applies to: the HTTP network guard and universal hook, the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption. At each of these admission sites the `trusted` argument SHALL be the mode-dependent admission list (empty in `"pair"` mode), per "Network match does not authenticate in pair mode".

When `requireLocalProof` is in effect (the default: absent or `true`), `isTrustedSource` SHALL additionally return `false` for a loopback-range peer that presents no local proof (local token, local credential proof, or local-proof cookie), as specified by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

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
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]` and effective trust mode `"legacy"`
- **WHEN** a request arrives from peer `192.168.16.20`, with or without forwarding headers
- **THEN** the trusted-network pass condition SHALL admit it

#### Scenario: LAN trusted CIDR does not admit in pair mode
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]` and effective trust mode `"pair"`
- **WHEN** an unauthenticated request arrives from peer `192.168.16.20`
- **THEN** no trusted-network pass condition SHALL admit it

### Requirement: Loopback trusted entries are reported as inert
When the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`) contains entries matching a loopback probe (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), the server SHALL log one `[trusted-networks]` warning naming each such entry and stating it is ignored for tunnel-relayed requests. The warning SHALL be deduplicated by the set of loopback-covering entries, not by the config file stamp, and SHALL NOT be recomputed while the resolved trusted-list array is unchanged (per-request cost on a snapshot cache hit is a reference compare).

`/api/health` SHALL include an additive field `trustPosture`, non-null only when `canDiscloseAccessPosture(request)` is true, of the shape:

```
trustPosture: {
  trustedHasLoopback: boolean,
  trustMode: "pair" | "legacy",
  trustModeOrigin: "upgrade" | "operator" | null,
  networkOnly: { admissions: number, distinctPeers: number, lastAt: number | null }
} | null
```

`trustModeOrigin` SHALL be `null` for an unrecognised stored value. `networkOnly` SHALL reflect the in-memory counters of "Network-only admissions are observed in legacy mode" (all zero / `null` in `"pair"` mode). Peer addresses SHALL NOT be included in `/api/health`.

#### Scenario: Warning on load
- **WHEN** the server resolves a trusted list containing `"127.0.0.1"`
- **THEN** it SHALL log a single `[trusted-networks]` warning naming `127.0.0.1`

#### Scenario: Unrelated config write does not re-warn
- **GIVEN** the warning for `"127.0.0.1"` was logged
- **WHEN** an unrelated config field is written and the snapshot reparses with the same trusted list
- **THEN** no further `[trusted-networks]` warning SHALL be logged

#### Scenario: Health flag gated by disclosure
- **GIVEN** the trusted list contains a loopback entry
- **WHEN** a genuine-local caller requests `/api/health`
- **THEN** the response SHALL include `trustPosture` with `trustedHasLoopback: true`, the effective `trustMode`, `trustModeOrigin`, and `networkOnly`
- **AND** an unauthenticated non-local caller SHALL receive `trustPosture: null`

#### Scenario: Health reports network-only admissions
- **GIVEN** effective mode `"legacy"` and two distinct peers made network-only admissions
- **WHEN** a genuine-local caller requests `/api/health`
- **THEN** `trustPosture.networkOnly.distinctPeers` SHALL be `2`
- **AND** no peer address SHALL appear in the response

### Requirement: Relayed-loopback denials raise no network grant prompt
When the network guard denies a request whose peer is in the loopback range and which carries a proxy-forwarding header, it SHALL still record the block event (marked non-trustable) but SHALL NOT notify the network-denial observer, so no network-plane grant prompt offering to trust the loopback address is raised.

#### Scenario: Tunnel denial does not prompt to trust loopback
- **GIVEN** grant prompting is enabled and an operator channel is connected
- **WHEN** a request from peer `127.0.0.1` carrying `X-Forwarded-For` is denied by the network guard
- **THEN** no network-plane grant prompt SHALL be raised
- **AND** the block event SHALL be recorded with `trustable: false`

#### Scenario: LAN denial still prompts
- **GIVEN** grant prompting is enabled and an operator channel is connected
- **WHEN** a request from untrusted peer `192.168.16.30` is denied
- **THEN** the network-denial observer SHALL be notified as today

### Requirement: Network trust mode
The config module SHALL support `network.trustMode` (`"pair"` | `"legacy"`) and `network.trustModeOrigin` (`"upgrade"` | `"operator"`).

**One-time decision at boot.** When the server starts, the configuration file parses, and `network.trustMode` is absent, it SHALL decide the mode once and persist it through the existing partial config write: `"pair"` if every entry of the resolved trusted list (`trustedNetworks` merged with `auth.bypassHosts`) is **loopback-only** — it admits no address outside `127.0.0.0/8`, `::1` and `::ffff:127.0.0.0/104` — (an empty list included), otherwise `"legacy"`. A match-all entry such as `0.0.0.0/0` or `*.*.*.*` is not loopback-only, and neither is any hostname entry (including `localhost`) — undecidable entries fall to `"legacy"` so an upgrade never locks a LAN user out; together with `trustModeOrigin: "upgrade"`. If the write fails, the server SHALL hold the decided mode as a process-level fallback, consulted only while the stored configuration holds no recognised `network.trustMode` (a stored value always wins, so a later successful operator save applies live), log one `[trusted-networks]` error, and decide again on the next boot. If the configuration file exists but cannot be parsed, the server SHALL NOT decide or write; it SHALL use `"legacy"` for the process as the fallback and log one `[trusted-networks]` error.

**Never re-derived.** Once `network.trustMode` holds a recognised value, the mode SHALL NOT change because the list changes — adding, removing or revoking entries SHALL leave the mode as stored. Any configuration write that changes a stored `network.trustMode` (UI, REST, CLI) SHALL set `trustModeOrigin: "operator"`; a stored mode with no origin (a hand edit) SHALL read as `"operator"`; a save that leaves the mode unchanged SHALL NOT touch the origin. Only the boot decision writes `"upgrade"`. A partial config write SHALL merge the `network` block field by field, so writing one of its fields never drops the other, and writing `network` never drops `auth` fields (or the reverse).

**Unrecognised value.** A present but unrecognised `network.trustMode` SHALL resolve to `"pair"` (fail closed), SHALL log one `[trusted-networks]` warning naming the value (once per process per distinct value, however often the mode is read), and SHALL NOT be overwritten by the boot decision.

The effective mode SHALL be read live through the same configuration snapshot the network guard reads, so an operator change takes effect without a restart.

#### Scenario: Fresh install decides pair
- **WHEN** the server boots with no `network.trustMode` and an empty resolved list
- **THEN** config SHALL be written with `network.trustMode: "pair"` and `network.trustModeOrigin: "upgrade"`

#### Scenario: Existing install with a LAN list decides legacy
- **WHEN** the server boots with no `network.trustMode` and `auth.bypassHosts: ["192.168.16.0/24"]`
- **THEN** config SHALL be written with `network.trustMode: "legacy"` and `network.trustModeOrigin: "upgrade"`
- **AND** a peer at `192.168.16.20` SHALL still be admitted without sign-in

#### Scenario: Match-all list decides legacy
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["0.0.0.0/0"]` (or `["*.*.*.*"]`)
- **THEN** the decided mode SHALL be `"legacy"`

#### Scenario: Loopback-only list decides pair
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["127.0.0.1", "127.0.0.4/30"]`
- **THEN** the decided mode SHALL be `"pair"`

#### Scenario: Adding a range never flips the mode
- **GIVEN** `network.trustMode: "pair"` is stored
- **WHEN** `198.51.100.23` is added to `auth.bypassHosts` and the server later restarts
- **THEN** the effective mode SHALL remain `"pair"` and `198.51.100.23` SHALL NOT be admitted without a credential

#### Scenario: Operator choice is recorded
- **WHEN** an operator saves `network.trustMode: "legacy"` from the Security page
- **THEN** config SHALL hold `network.trustModeOrigin: "operator"`

#### Scenario: Unknown value fails closed
- **WHEN** config holds `network.trustMode: "open"`
- **THEN** the effective mode SHALL be `"pair"`, one `[trusted-networks]` warning naming `"open"` SHALL be logged, and the stored value SHALL NOT be rewritten

#### Scenario: Boot write failure
- **WHEN** the boot decision cannot be persisted
- **THEN** every admission site SHALL use the decided mode for this process and one `[trusted-networks]` error SHALL be logged
- **AND** a later successful write of `network.trustMode: "legacy"` SHALL take effect on the next request without a restart

#### Scenario: Unparseable config is never overwritten
- **GIVEN** `config.json` exists but is not valid JSON
- **WHEN** the server boots
- **THEN** the file SHALL NOT be written, the effective mode SHALL be `"legacy"` for the process, and one `[trusted-networks]` error SHALL be logged

#### Scenario: Hostname entry decides legacy
- **WHEN** the server boots with no `network.trustMode` and a resolved list of only `["localhost"]` or `["nas.local"]`
- **THEN** the decided mode SHALL be `"legacy"`

#### Scenario: REST write records operator origin
- **WHEN** `PUT /api/config` changes `network.trustMode` from `"legacy"` to `"pair"` without naming an origin
- **THEN** config SHALL hold `network.trustModeOrigin: "operator"`

#### Scenario: Partial write keeps the origin
- **GIVEN** config holds `network: { trustMode: "legacy", trustModeOrigin: "upgrade" }`
- **WHEN** a partial write carries only `auth.bypassHosts`
- **THEN** both `network` fields SHALL be unchanged

#### Scenario: Mode change applies without restart
- **GIVEN** the effective mode is `"legacy"` and peer `192.168.16.20` is admitted by the list
- **WHEN** `network.trustMode` is written as `"pair"` while the server runs
- **THEN** the next unauthenticated HTTP request and the next ticketless WebSocket upgrade from `192.168.16.20` SHALL be denied without a restart

### Requirement: Network match does not authenticate in pair mode
When the effective trust mode is `"pair"`, a match of the socket peer against `trustedNetworks` / `auth.bypassHosts` SHALL NOT satisfy any admission or exemption decision. This SHALL hold at every site that consults the trusted list for admission: the HTTP network guard (per-route and universal hook), the OAuth `onRequest` bypass-host skip, the WebSocket upgrade with auth configured, the WebSocket upgrade with auth not configured, and the device-tier exemption. All of these sites SHALL obtain the list they match against **per request** from a single live source that yields an empty list under `"pair"`; no site SHALL hold a boot-time or reload-time copy of the list for admission.

Genuine-local callers (loopback, no forwarding header, subject to `requireLocalProof`), the local-IPC token, an authenticated login session, a valid device bearer or device cookie, a valid WebSocket ticket, and a valid model-proxy key SHALL be admitted exactly as before. The list itself SHALL remain stored, listed and editable; in `"pair"` mode it governs knock eligibility only (see the `lan-knock-pairing` capability). The CORS origin allowlist and the WebSocket origin gate MAY continue to match the list; they grant no credential.

#### Scenario: LAN peer in the list is denied in pair mode
- **GIVEN** effective mode `"pair"` and `auth.bypassHosts: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` arrives from `192.168.16.20` with no credential
- **THEN** the response SHALL be 403 with `error: "network_not_allowed"`

#### Scenario: WebSocket from a listed peer needs a ticket in pair mode
- **GIVEN** effective mode `"pair"`, auth not configured, and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a `/ws` upgrade arrives from `192.168.16.20` with no ticket and no cookie
- **THEN** the upgrade SHALL be rejected

#### Scenario: OAuth bypass-host skip is inert in pair mode
- **GIVEN** effective mode `"pair"`, auth configured, and `auth.bypassHosts: ["10.0.0.0/8"]`
- **WHEN** a request arrives from `10.0.0.5` with no session cookie
- **THEN** the auth hook SHALL NOT skip authentication

#### Scenario: Listed peer bearing a device credential keeps its tier
- **GIVEN** effective mode `"pair"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` bearing an `observe` device credential calls `POST /api/restart`
- **THEN** the request SHALL be refused with 403 `insufficient_scope` (no trusted-network tier exemption)

#### Scenario: Paired browser on the LAN keeps working
- **GIVEN** effective mode `"pair"`
- **WHEN** a browser at `192.168.16.20` holding a valid device cookie requests `GET /api/sessions`
- **THEN** the request SHALL be served

#### Scenario: Genuine local unaffected
- **WHEN** `requireLocalProof` is disabled, effective mode is `"pair"`, and a request arrives from `127.0.0.1` with no forwarding header
- **THEN** it SHALL be admitted

#### Scenario: Legacy mode keeps today's behaviour
- **GIVEN** effective mode `"legacy"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` arrives from `192.168.16.20` with no credential
- **THEN** the request SHALL be admitted

### Requirement: Network-only admissions are observed in legacy mode
In `"legacy"` mode the server SHALL record every **network-only admission** — an HTTP request or WebSocket upgrade admitted solely because its peer matched the trusted list, with no other pass condition holding (not genuine-local, no local-IPC token, no valid login session, no valid device credential, no valid ticket). An admission skipped through by the OAuth bypass-host rule leaves the request unauthenticated and is counted at the network guard. To make this classification truthful, every admission site — including the OAuth `onRequest` hook, which SHALL validate a presented session cookie before applying the bypass-host skip — SHALL evaluate credential-based pass conditions before the network match, without changing which requests are admitted. On a bypass-host request an invalid or expired session cookie SHALL NOT be cleared (today's behaviour); a single-use ticket presented with a listed peer address MAY be consumed. A WebSocket upgrade has one attribution point and is counted there. A request SHALL be counted at most once, however many guards evaluate it.

The server SHALL keep, in memory, the count of network-only admissions and the set of distinct peer addresses, each peer keyed by its most recent admission time (a repeat refreshes it), over a rolling window of 7 days or the server's uptime, whichever is shorter. The set SHALL be capped at 256 peers, evicting the least recently seen. It SHALL log one `[trusted-networks]` line per peer at most once per hour naming the peer and stating it reaches the dashboard by network trust only. In `"pair"` mode no network-only admission can occur and none SHALL be recorded.

#### Scenario: Unauthenticated LAN request counts once
- **GIVEN** effective mode `"legacy"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** `GET /api/sessions` (a route that also carries a per-route network guard) arrives from `192.168.16.20` with no credential
- **THEN** the network-only admission count SHALL increase by exactly one and `192.168.16.20` SHALL be in the distinct-peer set

#### Scenario: Paired device on a trusted network does not count
- **GIVEN** effective mode `"legacy"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` presents a valid device cookie
- **THEN** it SHALL be admitted and SHALL NOT be counted as network-only

#### Scenario: Signed-in browser on a bypass host does not count
- **GIVEN** effective mode `"legacy"`, auth configured, and `auth.bypassHosts: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` presents a valid login session cookie
- **THEN** it SHALL be marked authenticated by the session and SHALL NOT be counted as network-only

#### Scenario: Ticketed WebSocket on a trusted network does not count
- **GIVEN** effective mode `"legacy"` and `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a `/ws` upgrade from `192.168.16.20` presents a valid ticket
- **THEN** the ticket SHALL be consumed, the upgrade admitted, and it SHALL NOT be counted as network-only

#### Scenario: Log is rate-limited per peer
- **WHEN** `192.168.16.20` makes 50 network-only admissions within one hour
- **THEN** exactly one `[trusted-networks]` line naming `192.168.16.20` SHALL be logged in that hour

#### Scenario: Peer set is bounded and recency-ordered
- **GIVEN** 256 peers are recorded and the oldest-inserted peer was seen again a minute ago
- **WHEN** a 257th distinct peer is admitted network-only
- **THEN** the least recently seen peer SHALL be evicted, not the re-seen one

### Requirement: Access settings show the migration banner
When the effective trust mode is `"legacy"` and at least one network-only admission was recorded in the window, `Settings → Access` SHALL show a banner stating how many distinct device addresses reach the dashboard by network trust only, with a link to the Security tab's network access section, where devices are paired and the mode is switched. When `trustModeOrigin` is `"upgrade"` the banner SHALL be a warning; when it is `"operator"` it SHALL be informational and state that network trust is the operator's choice. The banner SHALL NOT be shown in `"pair"` mode. The Access page itself SHALL gain no grant-creation or mode control (its revoke-only contract stands). The data SHALL come from `/api/health` `trustPosture` (see "Loopback trusted entries are reported as inert").

#### Scenario: Banner names the device count
- **GIVEN** effective mode `"legacy"`, origin `"upgrade"`, and 3 distinct network-only peers in the window
- **WHEN** an operator opens `Settings → Access`
- **THEN** a warning banner SHALL state that 3 devices reach this dashboard by network trust only and link to the Security network access section

#### Scenario: Operator opt-in is informational
- **GIVEN** effective mode `"legacy"`, origin `"operator"`, and at least one network-only peer
- **WHEN** `Settings → Access` opens
- **THEN** the banner SHALL be informational and state that network trust is the operator's choice

#### Scenario: Network-admitted caller learns nothing
- **GIVEN** effective mode `"legacy"` and a caller admitted only by a listed LAN address, with no credential
- **WHEN** it opens `Settings → Access`
- **THEN** `trustPosture` SHALL be `null` for it and no banner SHALL be shown (it must sign in or pair to see the posture)

#### Scenario: No banner in pair mode
- **WHEN** the effective mode is `"pair"`
- **THEN** no network-trust migration banner SHALL be shown
