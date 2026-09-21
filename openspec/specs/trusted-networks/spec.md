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
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[])` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) loopback address (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), (b) IP matching an entry in `trustedNetworks` (CIDR, wildcard, or exact match), or (c) `request.isAuthenticated` is `true` (set by the auth `onRequest` hook).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"` (replacing the prior human string `"Access denied"`), so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback, not in trustedNetworks, and request not authenticated"`).
- `hint` SHALL describe the remedy (e.g. `"Add this network to trustedNetworks (Settings → Servers) or sign in."`).

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

#### Scenario: Loopback IP allowed
- **WHEN** a request arrives from `127.0.0.1`
- **THEN** the guard SHALL allow the request regardless of trustedNetworks or authentication

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (add to `trustedNetworks` or authenticate)

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
`networkGuard` field (created once from `resolvedTrustedNetworks` at startup);
that threading remains valid but is no longer the protection boundary.

Jurisdiction and in-namespace exception matching SHALL operate on the parsed
request **pathname** (query string and fragment stripped), with prefix matches
anchored on a trailing slash, so neither a query string (`/api/health?x=1`) nor a
near-miss prefix (`/apiv2`, `/api/healthz`) changes the decision.

The guard SHALL be registered as the **last** `onRequest` hook unconditionally —
after the host gate, CORS, the mutation-origin gate, CSP, `registerBearerAuth`,
`registerAuthPlugin` (when configured), the route-tier gate, and the model-proxy
auth gate (when configured) — so `request.isAuthenticated` reflects every auth
source when the guard evaluates. "Last" SHALL NOT be expressed relative to a
conditional hook.

The guard SHALL read the trusted-network set through the live thunk (the same
source `createNetworkGuard` uses), never a boot snapshot, so a CIDR added at
runtime admits without a restart.

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
- **WHEN** a CIDR is added to the trusted-network set while the server is running and a request arrives from that network
- **THEN** the guard SHALL allow it without a restart

#### Scenario: Session route uses network guard
- **WHEN** a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

### Requirement: WebSocket upgrade respects trusted networks
The WebSocket upgrade handler in `server.ts` SHALL check trusted networks in addition to loopback and auth. A connection from a trusted network IP SHALL be allowed without authentication. The `validateWsUpgrade` function SHALL accept the trusted networks list and check it.

#### Scenario: WebSocket from trusted network without auth
- **WHEN** a WebSocket upgrade arrives from `192.168.1.42` with `trustedNetworks: ["192.168.1.0/24"]` and no auth cookie
- **THEN** the upgrade SHALL proceed

#### Scenario: WebSocket from untrusted IP without auth
- **WHEN** a WebSocket upgrade arrives from `203.0.113.5` with no auth cookie and auth is configured
- **THEN** the upgrade SHALL be rejected with 401

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
The auth plugin `onRequest` hook SHALL skip authentication for requests from IPs matching `resolvedTrustedNetworks` (the merged list). This replaces the current `auth.bypassHosts`-only check.

#### Scenario: Auth bypassed for trusted network IP
- **WHEN** auth is configured and a request arrives from an IP in `resolvedTrustedNetworks`
- **THEN** the auth hook SHALL skip authentication for that request

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

The auth plugin SHALL continue to no-op when `providerRegistry.size === 0`: no OAuth routes registered, no `onRequest` hook installed, no cookie plugin initialized. The bypassHosts behaviour SHALL be served entirely through `resolvedTrustedNetworks` and the network guard.

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
- **AND** no cookie plugin SHALL be registered
- **AND** `request.isAuthenticated` SHALL default to `false` for all requests
- **AND** the network guard SHALL still admit requests from `192.168.1.0/24` via `resolvedTrustedNetworks`

### Requirement: WebSocket upgrade admits bypassHosts trust without OAuth
The WebSocket upgrade handler in `server.ts` SHALL admit a connection from an IP matching `resolvedTrustedNetworks` regardless of whether OAuth is configured. When `config.authConfig` is absent or its resolved provider registry is empty, the upgrade SHALL NOT require a JWT cookie; the IP match alone SHALL be sufficient to proceed.

#### Scenario: WebSocket upgrade from bypassHosts-only trusted network
- **WHEN** config is `{ "auth": { "providers": {}, "bypassHosts": ["192.168.1.0/24"] } }` and a WebSocket upgrade request arrives from `192.168.1.42` with no auth cookie
- **THEN** the upgrade SHALL proceed (101 Switching Protocols)
- **AND** the connection SHALL NOT be rejected with 403 or 401

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

#### Scenario: plugin route denied over tunnel with auth off
- **WHEN** auth is not configured and a proxied/tunneled request (forwarding headers present, so not genuine-local) arrives at `POST /api/plugins/automation/create` from an untrusted IP
- **THEN** the guard SHALL deny the request with 403, write no automation file, and spawn no agent

#### Scenario: provider-auth route denied with auth off
- **WHEN** auth is not configured and an untrusted, unauthenticated request arrives at `PUT /api/provider-auth/api-key`
- **THEN** the guard SHALL deny the request with 403

#### Scenario: loopback allowed with auth off
- **WHEN** auth is not configured and a genuine-local loopback request arrives at a guarded route
- **THEN** the guard SHALL allow the request

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, and configured `auth.bypassUrls` prefixes. All
other in-jurisdiction requests SHALL require a pass condition (loopback /
genuine-local, trusted-network IP, or `isAuthenticated`).

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

Every configured trusted network SHALL be listed in `Settings → Access` and SHALL offer a revoke action that removes it through the existing configuration write path.

#### Scenario: Configured entries are listed

- **WHEN** the Access page is opened and trusted networks are configured
- **THEN** each entry SHALL be listed with its CIDR, wildcard, or exact host value

#### Scenario: Revoking removes the entry

- **WHEN** a trusted-network entry is revoked from the Access page
- **THEN** it SHALL be removed from configuration via the existing write path

#### Scenario: Revocation takes effect without restart

- **GIVEN** the guard reads trusted networks through the live configuration snapshot
- **WHEN** an entry is revoked
- **THEN** a subsequent request from that peer SHALL be denied without a server restart

### Requirement: Trust is acquirable by accepting a pending access request

A trusted network entry SHALL be addable by accepting a pending access request derived from a recorded denial, in addition to the existing tunnel banner and settings paths. Acceptance SHALL be available only for entries classified as trustable.

#### Scenario: Accepting a pending request adds trust

- **WHEN** a trusted client accepts a pending access request for a trustable peer
- **THEN** that peer SHALL be added to trusted networks

#### Scenario: Loopback or proxied peer cannot be accepted

- **WHEN** a pending access request is classified non-trustable
- **THEN** no accept action SHALL be offered, so trusting an entire tunnel is not possible through this path
