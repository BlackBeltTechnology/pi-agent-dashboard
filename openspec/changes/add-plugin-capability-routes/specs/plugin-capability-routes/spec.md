## ADDED Requirements

### Requirement: Trusted plugins register capability prefixes in their own namespace
`ServerPluginContext` SHALL offer `registerCapabilityRoute({ prefix, verify })`, returning an unregister handle.
- The prefix SHALL start literally with `/api/plugins/<pluginId>/` of the registering plugin and end with `/`, with every segment matching `[a-z0-9-]+`.
- A plugin id not matching `^[a-z0-9-]+$`, a foreign prefix, or a prefix nested in or containing an already registered prefix SHALL throw at registration.
- Registration SHALL take effect only for a **trusted** plugin: its package directory name is in `packages/server/package.json#piDashboard.bundledPlugins`, or its manifest id is in config `auth.capabilityRoutePlugins`. Any other plugin SHALL receive an inert handle and one warning. Manifest `priority` SHALL NOT confer this trust. A config whose `auth` holds only `capabilityRoutePlugins` SHALL keep that list.
- Registrations SHALL be tracked per plugin and removed on disable, teardown or failed activation. A later activation MAY register again.

#### Scenario: Foreign namespace refused
- **WHEN** plugin `voice-wall` registers prefix `/api/plugins/flows/s/`
- **THEN** registration throws and no prefix is registered

#### Scenario: Look-alike id cannot reach a sibling namespace
- **WHEN** plugin `a` registers `/api/plugins/ab/s/`
- **THEN** registration throws

#### Scenario: Nested prefix refused
- **WHEN** a plugin has registered `/api/plugins/x/s/` and registers `/api/plugins/x/s/sub/`
- **THEN** the second registration throws

#### Scenario: Priority does not confer trust
- **WHEN** a plugin not in `bundledPlugins` or `auth.capabilityRoutePlugins` declares `priority: 1` and registers a prefix
- **THEN** it receives an inert handle and an anonymous GET under that prefix is denied

#### Scenario: Disable removes the prefix
- **WHEN** the registering plugin is disabled
- **THEN** an anonymous GET under its prefix with a token its verifier would accept is denied

### Requirement: One capability evaluation per request, honoured by every admission check
A single onRequest hook, registered after the host gate and before every other admission check, SHALL evaluate each request once:
- when the method is GET or HEAD, and both the raw and the dot-resolved target lie under one registered prefix, it SHALL call that prefix's verifier exactly once;
- it SHALL record acceptance on the request.

A verifier that throws SHALL count as refusal. The identity floor, the auth plugin, the universal network guard, the per-route network guard and the identity road gate SHALL each admit a request carrying that acceptance, and SHALL NOT call the verifier themselves. A refused request SHALL continue to each check's normal pass conditions and receive its normal denial.

#### Scenario: Verified anonymous GET reaches a guarded plugin route
- **WHEN** identity is enforced with a host policy, OAuth is configured, and an untrusted remote client sends `GET /api/plugins/voice-wall/s/events` with a token the verifier accepts, to a route that attaches `ctx.networkGuard`
- **THEN** every check admits it and the route handler runs

#### Scenario: Verifier runs once
- **WHEN** that request is processed
- **THEN** the verifier was called exactly once

#### Scenario: Unsafe method never admitted
- **WHEN** the same client sends `POST /api/plugins/voice-wall/s/events` with a valid token
- **THEN** the verifier is not called and the request is denied as unauthenticated

#### Scenario: Dot-segment smuggling denied
- **WHEN** an anonymous client sends `GET /api/plugins/voice-wall/s/../../sessions` with a valid token
- **THEN** the request is denied, because the resolved view is not under the prefix

#### Scenario: Throwing verifier denies
- **WHEN** the verifier throws
- **THEN** the request is denied with the normal denial and one warning without header values is logged

#### Scenario: Signed-in user without a token still passes normally
- **WHEN** a signed-in user sends a GET under the prefix without a token
- **THEN** the checks admit it by their normal pass conditions

#### Scenario: No registrations, no change
- **WHEN** no plugin has registered a capability prefix
- **THEN** every check's decisions equal today's for the full guard test corpus

### Requirement: Capability logging never records credentials
Capability admissions SHALL be logged at debug level and capability rejections at warn level, rate-limited to one capability line per prefix per minute with a count. No capability log line SHALL contain a request header value or query string. For a request under a registered prefix, the network guard's denial line SHALL log the prefix instead of the full path. A refused capability request SHALL NOT be recorded in the network-denial ring buffer and SHALL NOT raise a trust-network prompt.

#### Scenario: Path beyond the prefix is not logged
- **WHEN** a request to `/api/plugins/x/s/abc123secret` is denied
- **THEN** the guard's denial line names `/api/plugins/x/s/` and does not contain `abc123secret`

#### Scenario: Capability refusal raises no trust prompt
- **WHEN** a LAN peer sends an invalid token under a registered prefix
- **THEN** no denial ring-buffer entry or trust-network prompt is created for it

#### Scenario: Rejection burst is one capability line
- **WHEN** 50 requests with invalid tokens hit one prefix within a minute
- **THEN** at most one `[capability] reject` line for that prefix is written in that minute, carrying the count, not a token

### Requirement: Plugins can read the request principal
`ServerPluginContext` SHALL offer `requestPrincipal(request)`, returning `null` for every request when the calling plugin is not trusted, and otherwise:
- `{ kind: "principal", iss, sub, name? }` when the identity plane resolved a principal;
- `{ kind: "local-operator" }` for the D23 local operator, or, with identity inert, for a genuinely local request or one carrying the local token;
- `null` otherwise.

It SHALL NOT treat the auth plugin's session cookie as a principal.

#### Scenario: Remote cookie user in single-user mode
- **WHEN** identity is inert and a remote browser authenticated by the OAuth session cookie calls a plugin route
- **THEN** `requestPrincipal` returns `null`

#### Scenario: Loopback operator in single-user mode
- **WHEN** identity is inert and a genuinely local request calls a plugin route
- **THEN** `requestPrincipal` returns `{ kind: "local-operator" }`

### Requirement: Plugins mount static apps under /apps/<appId>/
`ServerPluginContext` SHALL offer `serveApp({ dir, csp, appId? })`, effective only for trusted plugins (an untrusted call mounts nothing and logs once). `appId` defaults to the plugin id, SHALL match `^[a-z0-9-]+$`, and SHALL be unique: a second mount of the same `appId` SHALL throw. `dir` SHALL realpath inside the plugin's package root, else throw. `csp` SHALL be required. The mount:
- SHALL redirect `/apps/<appId>` with 308 to `/apps/<appId>/`, and SHALL answer GET and HEAD;
- SHALL serve only realpath-confined files under `dir` with an extension in `.html .js .mjs .css .svg .png .jpg .jpeg .gif .webp .ico .woff .woff2`, and never `.json`, `.map`, dotfiles or directories;
- SHALL fall back to `index.html` for unmatched paths;
- SHALL mark content-hashed files immutable and `index.html` `no-store`;
- SHALL return a 503 text page for a missing build, logged once;
- SHALL send `csp` as an enforced `Content-Security-Policy` on every file response;
- SHALL be skipped by the auth plugin, so it loads without sign-in when OAuth is configured;
- SHALL be recorded in a mount registry that the namespace-coverage test consults.

#### Scenario: Path traversal refused
- **WHEN** a client requests `/apps/wall/../../etc/passwd`, or a symlink inside `dir` points outside it
- **THEN** no file outside `dir` is served

#### Scenario: Non-asset file never served
- **WHEN** `dir` contains `config.json` and `app.js.map` and a client requests them
- **THEN** neither is served

#### Scenario: Deep link serves the shell
- **WHEN** a client requests `/apps/wall/m/abc`
- **THEN** `index.html` is returned with `Cache-Control: no-store`

#### Scenario: Loads without sign-in under OAuth
- **WHEN** OAuth is configured and an unauthenticated phone requests `/apps/wall/` and its assets
- **THEN** they are served, not redirected to `/auth/login`

#### Scenario: Untrusted plugin cannot squat an app id
- **WHEN** an untrusted plugin calls `serveApp({ appId: "wall", … })` before the trusted wall plugin activates
- **THEN** nothing is mounted for it, and the trusted plugin's mount succeeds

#### Scenario: Directory outside the package refused
- **WHEN** a plugin calls `serveApp({ dir: "/" , csp })`
- **THEN** the call throws and nothing is mounted
