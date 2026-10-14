## ADDED Requirements

### Requirement: Plugins may register routes in a plugin public namespace

The server plugin context SHALL offer `registerPublicRoute({ method, path, handler, bodyLimit?, allowHeaders? })`, callable only during the plugin's server-entry activation; a call outside activation SHALL throw. `method` SHALL be `GET` or `POST`. `path` SHALL be validated as the raw registration string: one or more non-empty segments of `[A-Za-z0-9._~-]`, none equal to `.` or `..`, joined by single `/`; any other character (including `%`, `\`, `*`, NUL) SHALL throw. The route mounts at `/api/plugins/<pluginId>/public/<path>`; a plugin id outside `[a-z0-9-]` SHALL make every call throw. Registering the same method and path twice SHALL throw. The default request body limit SHALL be 64 KiB; a plugin-supplied `bodyLimit` above 1 MiB SHALL throw. `allowHeaders` lists extra request headers the route accepts cross-origin (default: `Content-Type`, `Authorization`); each entry SHALL be an RFC 7230 token or the call SHALL throw. Only routes registered through `registerPublicRoute` are served under the namespace: a route a plugin mounts there through its raw server instance SHALL NOT be reachable (the namespace hook answers `404` for any namespace path without a registered public route). `HEAD` requests to the namespace SHALL be answered `405` by the namespace hook without invoking any handler.

The handler SHALL receive the request with its peer address and `Origin` and SHALL be able to read `ctx.identity.principalOf(request)`. Registration grants nothing by itself: no request reaches a public route unless the operator enables that plugin's namespace; manifest-declared priority SHALL NOT enable or widen a namespace.

#### Scenario: Plugin mounts a public route
- **WHEN** plugin `web-chat` registers `{ method: "POST", path: "messages" }` during activation and the operator enabled its namespace
- **THEN** `POST /api/plugins/web-chat/public/messages` SHALL reach its handler

#### Scenario: Unsafe paths are refused
- **WHEN** a plugin registers any of `../admin`, `/api/sessions`, `a//b`, `a/./b`, `a%2Fb`, `a\b`, `a/*`
- **THEN** each call SHALL throw and mount nothing

#### Scenario: Duplicate registration is refused
- **WHEN** a plugin registers `GET stream` twice
- **THEN** the second call SHALL throw

#### Scenario: HEAD is refused
- **WHEN** a `HEAD` request targets a registered public `GET` route
- **THEN** the host SHALL answer `405` and the handler SHALL NOT run

#### Scenario: Oversized body rejected
- **WHEN** a request body exceeds the route's body limit
- **THEN** the host SHALL answer `413` without invoking the handler

### Requirement: The namespace is decided first, by one predicate

A single predicate SHALL decide whether a request targets an **enabled public namespace**: BOTH its raw and its resolved path (the two views the network guard evaluates; a target the guard cannot parse fails the predicate) lie under the same `/api/plugins/<pluginId>/public/`, the plugin is enabled and loaded, and the operator config sets `plugins.<pluginId>.publicRoutes.enabled: true`. Every gate this capability exempts or alters SHALL use this predicate. The predicate SHALL read a configuration snapshot refreshed on config change (effective within 2 seconds, no restart), not the config file per request.

A namespace hook SHALL run immediately after the host gate and before CORS, the mutation origin gate, the cookie parser and every authentication hook; namespace traffic still counts against the server's existing global request rate limiter. When the path is under a plugin public namespace that is not enabled — including a plugin disabled or unloaded at runtime — it SHALL answer `404` with no network-guard denial event, no access prompt and no CORS headers. The host gate still applies to the namespace.

#### Scenario: Disabled namespace is not found from any peer
- **WHEN** `publicRoutes.enabled` is false or absent and a remote, unauthenticated peer sends `GET /api/plugins/web-chat/public/widget.js`, a `POST` with an untrusted `Origin`, and an `OPTIONS` preflight from a listed origin
- **THEN** each SHALL be answered `404` with no CORS header and no guard denial event

#### Scenario: Plugin disabled at runtime takes the namespace down
- **WHEN** the operator disables the `web-chat` plugin while its namespace is enabled in config
- **THEN** subsequent namespace requests SHALL be answered `404` without a restart

#### Scenario: Dot-segment escape gets no exemption
- **WHEN** a request targets `/api/plugins/web-chat/public/../config`
- **THEN** the predicate SHALL NOT match (the resolved path is outside the namespace), and the request SHALL be handled exactly as a request to `/api/plugins/web-chat/config`

#### Scenario: Unparseable and encoded variants fail closed
- **WHEN** requests target `//api/plugins/web-chat/public/messages` and `/api/plugins/web-chat/%70ublic/messages`
- **THEN** neither SHALL receive a namespace exemption; each is denied or not found as the guard decides for an unparseable or non-namespace target

#### Scenario: Unregistered namespace path is not found
- **WHEN** an enabled namespace receives `GET` or `OPTIONS` for a path no public route is registered at
- **THEN** the answer SHALL be `404` with no CORS grant

### Requirement: Public routes are origin-pinned

`plugins.<pluginId>.publicRoutes.allowedOrigins` (default empty) SHALL list origins of the form `scheme://host[:port]` with scheme `https`, or `http` only for `localhost`, `127.0.0.1` or `[::1]`. Entries SHALL be canonicalized at load (lowercase scheme and host, IDN to punycode, default port removed, IPv6 bracketed); entries that are `null`, contain a path, query, fragment, trailing slash, wildcard or userinfo SHALL be rejected at load and logged. A request `Origin` SHALL be canonicalized the same way before comparison. That list SHALL be the only source of cross-origin admission for the namespace: an empty list admits no cross-origin request, and no dashboard-wide origin rule (configured origins, loopback, tunnels, trusted networks, neutral shell origin) SHALL apply there.

For the namespace the host SHALL answer CORS itself, ahead of the dashboard's global CORS handling: it SHALL reflect `Access-Control-Allow-Origin` only for an allowed origin, SHALL NOT send `Access-Control-Allow-Credentials`, SHALL send `Vary: Origin` on every namespace response, and SHALL answer a preflight `OPTIONS` for a registered path with the methods registered at that path, the union of their `allowHeaders` and `Access-Control-Max-Age: 600`. The dashboard's global CORS handling SHALL grant nothing to a request the namespace hook marked — granting no headers when the preflight requests any header outside `allowHeaders`. The same exact match SHALL decide the mutation origin gate (see `cross-site-request-gate`). Removing an origin takes effect server-side immediately; a browser may reuse a cached preflight for at most 600 seconds.

#### Scenario: Empty allowlist admits no cross-origin request
- **WHEN** `allowedOrigins` is empty and a request carries `Origin: http://localhost:3000`
- **THEN** no `Access-Control-Allow-Origin` header SHALL be sent, and a `POST` with that Origin SHALL be rejected `403`

#### Scenario: Unlisted origin gets no CORS grant
- **WHEN** a request carries `Origin: https://evil.example` not in `allowedOrigins`
- **THEN** the response SHALL carry `Vary: Origin` and no `Access-Control-Allow-Origin` header

#### Scenario: Listed origin preflight succeeds without credentials
- **WHEN** an `OPTIONS` preflight carries `Origin: https://shop.example`, `https://Shop.Example:443` is listed (canonicalized to `https://shop.example` at load), for a registered `POST messages` route requesting `Content-Type`
- **THEN** the host SHALL answer with `Access-Control-Allow-Origin: https://shop.example`, `Access-Control-Allow-Methods: POST`, the route's allowed headers, `Access-Control-Max-Age: 600`, `Vary: Origin`, and no `Access-Control-Allow-Credentials`

#### Scenario: Preflight for an unlisted header is refused
- **WHEN** a preflight from a listed origin requests header `X-Debug` not in `allowHeaders`
- **THEN** the response SHALL grant no `Access-Control-Allow-Headers`

#### Scenario: Invalid origin entries are rejected at load
- **WHEN** `allowedOrigins` contains `null`, `https://*.example`, `https://shop.example/`, `http://192.168.1.5` and `https://shop.example`
- **THEN** only `https://shop.example` SHALL be effective and the other four SHALL be logged as rejected

### Requirement: Public routes carry no dashboard authority

For a request under an enabled public namespace, the namespace hook (before the cookie parser and every authentication hook) SHALL:
- remove the entire `Cookie` header, so neither dashboard cookies (`pi_dash_token`, `pi_dash_oauth_state`, `pi_dash_local`, `pi_dash_device`) nor any other cookie reaches parsing or the handler;
- remove the `X-Pi-Local-Token` and `X-Pi-Local-Proof` headers and reset any local-credential verdict already stamped on the request to absent;
- mark the request so that the OAuth authentication gate, the device-bearer branch and the break-glass operator bearer branch (`pi_op_…`) do not run for it;
- refuse with `400`, before the handler, a request whose query string carries a key that — compared case-insensitively after removing `-`, `_` and a trailing `[]` — equals `token`, `accesstoken`, `key`, `apikey`, `auth`, `credential`, `password` or `secret` (credentials SHALL NOT travel in URLs); namespace request logging SHALL record the pathname only.

Principal resolution SHALL then run at its existing position. When identity is enforced, a bearer that a trusted principal resolver accepts SHALL set the principal readable via `ctx.identity.principalOf(request)`, a bearer that a resolver claims but rejects SHALL be answered `401` before the handler, and a bearer no resolver claims SHALL reach the handler with `principalOf(request) === null`. When identity is inert the `Authorization` header SHALL be ignored and `principalOf` SHALL return `null`. Any dashboard credential presented on the namespace — valid, revoked, malformed or unknown device bearer, break-glass bearer, cookie or local token — SHALL be treated as absent and SHALL NOT produce a `401`; only a resolver's claim-and-reject does. The request SHALL NOT be marked dashboard-authenticated; the network guard SHALL admit it from any peer (see `trusted-networks`); the device-bearer tier gate SHALL skip it (see `bearer-device-auth`); the identity floor SHALL NOT answer `sign_in_required` for it. Plugin-defined credentials SHALL travel in a request header other than `Authorization`. The handler SHALL be solely responsible for authenticating and authorizing each request.

#### Scenario: Remote unauthenticated peer reaches the handler
- **WHEN** a non-loopback peer without any credential calls an enabled public route while identity is enforced and OAuth is configured
- **THEN** the handler SHALL run with `ctx.identity.principalOf(request) === null`, with no `401`, login redirect or `sign_in_required`

#### Scenario: Dashboard credentials are removed before authentication
- **WHEN** an operator's browser calls a public route carrying the `pi_dash_token`, `pi_dash_device` and `pi_dash_local` cookies, an `X-Pi-Local-Token` and an `X-Pi-Local-Proof` header
- **THEN** the handler SHALL observe none of them, and the request SHALL NOT be authenticated, device-tagged, tier-stamped or credited with a local credential

#### Scenario: Device and break-glass bearers grant nothing
- **WHEN** identity is enforced and a public-route request carries a valid paired-device bearer, or a valid `pi_op_` break-glass bearer
- **THEN** neither SHALL authenticate the request or set an operator principal; the handler SHALL run with `principalOf(request) === null`

#### Scenario: Resolver bearer yields a principal
- **WHEN** identity is enforced and a public-route request carries `Authorization: Bearer <token>` accepted by the OIDC principal resolver
- **THEN** `ctx.identity.principalOf(request)` SHALL return that principal

#### Scenario: Claimed-but-invalid bearer is refused
- **WHEN** identity is enforced and the OIDC resolver claims an expired token from its issuer
- **THEN** the host SHALL answer `401` and the handler SHALL NOT run

#### Scenario: Bearer ignored while identity is inert
- **WHEN** identity is inert and a public-route request carries any `Authorization: Bearer` value
- **THEN** the handler SHALL run with `principalOf(request) === null`

#### Scenario: Credential in the query string is refused
- **WHEN** a request targets `/api/plugins/web-chat/public/stream?token=abc`
- **THEN** the host SHALL answer `400`, the handler SHALL NOT run, and no log line SHALL contain `abc`

### Requirement: Public roads are classified for the host access policy

Every public-namespace request SHALL carry the non-session road classification `{ action: "plugin:<pluginId>:public", resource: { path } }`. When a host access policy is registered and the request carries a principal, the policy SHALL decide it like any classified non-session road (deny ⇒ `403` before the handler). A principal-less request SHALL NOT be submitted to the policy: the host access policy governs principals only, and the plugin's own authentication is the sole gate for anonymous traffic.

#### Scenario: Policy denies a principal on a public road
- **WHEN** a policy denies `plugin:web-chat:public` for a principal, and that principal calls an enabled web-chat public route
- **THEN** the host SHALL answer `403` and the handler SHALL NOT run

#### Scenario: Principal-less request skips the policy
- **WHEN** a policy is registered and a request without a principal calls an enabled public route
- **THEN** the policy SHALL NOT be invoked and the handler SHALL run

### Requirement: Public routes are bounded

Per namespace the host SHALL bound: concurrent in-flight non-stream requests at `plugins.<pluginId>.publicRoutes.maxConcurrent` (default 512, answering `503` beyond); a non-stream request's duration at 30 seconds (answering `408` and aborting the handler's signal); concurrent open streams at `maxStreams` (default 256) and at `maxStreamsPerPeer` (default 8) per peer address (answering `503` beyond either). The per-peer key SHALL be the socket peer address; behind a tunnel or reverse proxy all customers share one peer, so the operator SHALL be able to set `maxStreamsPerPeer: 0` to disable the per-peer cap, and per-customer limits are the plugin's responsibility. When the plugin is disabled or unloaded, in-flight namespace requests SHALL be aborted and open streams closed.

#### Scenario: Non-stream concurrency cap
- **WHEN** 512 non-stream requests are in flight on the namespace and another arrives
- **THEN** the host SHALL answer `503`

#### Scenario: Slow handler times out
- **WHEN** a non-stream handler has not completed after 30 seconds
- **THEN** the client SHALL receive `408` and the handler's abort signal SHALL fire

#### Scenario: Per-peer cap can be disabled for tunnel deployments
- **WHEN** `maxStreamsPerPeer` is `0` and 20 streams from one peer address are open, below `maxStreams`
- **THEN** none SHALL be refused for the per-peer cap

#### Scenario: Per-peer stream share
- **WHEN** one peer address holds 8 open streams and opens a ninth, while the namespace total is below `maxStreams`
- **THEN** the host SHALL answer `503` to that peer only

### Requirement: Public routes support streaming responses

A public `GET` handler SHALL open a stream through a host helper `openEventStream(request, reply)` returning `{ send(event, data), close(), onClose(callback) }`; only streams opened through the helper are counted against the stream caps. Streams SHALL be `text/event-stream` responses consumable by `fetch` with request headers (they SHALL NOT depend on `EventSource`, which cannot send credential headers). For an open stream the host SHALL disable the server's connection-inactivity timeout and response compression, SHALL emit an SSE comment heartbeat at least every 4 seconds, SHALL close the stream when the request's principal credential expires (for a principal-bearing request), and SHALL invoke each `onClose` callback exactly once when the client disconnects, when the handler calls `close()`, or when the plugin is disabled or unloaded.

#### Scenario: Idle stream survives with heartbeats
- **WHEN** a stream carries no application frame for 30 seconds
- **THEN** the client SHALL have received at least 7 heartbeat comments and the stream SHALL still be open

#### Scenario: Stream cap
- **WHEN** 256 streams are open on the namespace and another stream request arrives
- **THEN** the host SHALL answer `503`

#### Scenario: Stream closes at principal expiry
- **WHEN** a stream was opened by a request whose resolver principal expires at time T
- **THEN** the host SHALL close the stream at T and run its `onClose` callback once

#### Scenario: Close callback runs exactly once on every trigger
- **WHEN** a stream ends by client disconnect, by handler `close()`, or by plugin disable
- **THEN** its `onClose` callback SHALL run exactly once in each case
