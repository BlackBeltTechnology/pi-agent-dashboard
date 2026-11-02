# oauth-authentication Specification

## Purpose
OAuth2/OIDC authentication for the dashboard. Provider registry (GitHub, Google, Keycloak, generic OIDC), login/callback flow, JWT session cookie, loopback + trusted-host/URL bypass, and redirect-URI resolution.

## Requirements

### Requirement: OAuth provider registry
The auth module SHALL maintain a registry of OAuth2 provider configurations. Each provider entry SHALL include: `clientId`, `clientSecret`, `authorizeUrl`, `tokenUrl`, `userInfoUrl`, and `scopes`. Built-in providers (GitHub, Google, Keycloak) SHALL have well-known URLs pre-configured; only `clientId` and `clientSecret` are required from the user. Keycloak and generic OIDC providers SHALL additionally require an `issuerUrl`.

#### Scenario: GitHub provider configured
- **WHEN** config contains `auth.providers.github` with `clientId` and `clientSecret`
- **THEN** the module SHALL register GitHub with authorize URL `https://github.com/login/oauth/authorize`, token URL `https://github.com/login/oauth/access_token`, user info URL `https://api.github.com/user`, and scope `user:email`

#### Scenario: Google provider configured
- **WHEN** config contains `auth.providers.google` with `clientId` and `clientSecret`
- **THEN** the module SHALL fetch OIDC discovery from `https://accounts.google.com/.well-known/openid-configuration` to resolve authorize, token, and userinfo endpoints, using scope `openid email profile`

#### Scenario: Keycloak provider configured
- **WHEN** config contains `auth.providers.keycloak` with `clientId`, `clientSecret`, and `issuerUrl`
- **THEN** the module SHALL fetch OIDC discovery from `{issuerUrl}/.well-known/openid-configuration` to resolve endpoints, using scope `openid email profile`

#### Scenario: Generic OIDC provider configured
- **WHEN** config contains `auth.providers.oidc` with `clientId`, `clientSecret`, `issuerUrl`, and optional `name`
- **THEN** the module SHALL fetch OIDC discovery from `{issuerUrl}/.well-known/openid-configuration` and use `name` as the display label (defaulting to "OIDC" if omitted)

#### Scenario: No providers configured
- **WHEN** config contains `auth` but `auth.providers` is empty or missing
- **THEN** the module SHALL treat auth as disabled (same as no `auth` key)

### Requirement: Localhost and trusted host bypass
The auth module SHALL skip authentication for requests originating from loopback
addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), subject to the local-proof
narrowing below.

- **`bypassUrls`.** If `auth.bypassUrls` is configured, the auth module SHALL
  skip authentication for HTTP requests whose URL starts with any entry in that
  list.
- **`bypassHosts`.** If `auth.bypassHosts` is configured **and the effective
  trust mode (`network.trustMode`, see the `trusted-networks` capability) is
  `"legacy"`**, the auth module SHALL skip authentication for requests
  originating from any matching IP (exact, wildcard, or CIDR). In `"pair"` mode
  a `bypassHosts` match SHALL NOT skip authentication.
- **Ordering.** The loopback and `bypassUrls` rules apply before any
  cookie/session validation. The `bypassHosts` rule (legacy only) applies after
  a presented session cookie has been validated, so a valid session
  authenticates the request as such.

These rules cover both HTTP requests and WebSocket upgrades.

The genuinely-local (loopback, non-forwarded) condition in this requirement is
narrowed by the "Opt-in local proof for loopback trust" requirement of
`trust-and-credential-boundaries`. That requirement is in effect by default
(`requireLocalProof` absent or `true`). Under it, a loopback request skips
authentication only for `observe`-tier `/api/*` routes unless it carries local
proof. Only with `requireLocalProof` explicitly `false` does the unnarrowed
loopback skip apply.

#### Scenario: Localhost HTTP request without cookie
- **WHEN** `requireLocalProof` is explicitly `false` and an HTTP request arrives from `127.0.0.1` with no auth cookie
- **THEN** the request SHALL proceed without authentication

#### Scenario: Localhost WebSocket upgrade without cookie
- **WHEN** `requireLocalProof` is explicitly `false` and a WebSocket upgrade request arrives from `::1` with no auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: Localhost control request without proof under the default
- **WHEN** `requireLocalProof` is absent and a `control`/`operate` HTTP request or a `/ws` upgrade arrives from `127.0.0.1` with no auth cookie and no local proof
- **THEN** the auth module SHALL NOT skip authentication for it

#### Scenario: External HTTP request without cookie
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL does not match any `bypassUrls` entry
- **THEN** the server SHALL redirect to `/auth/login` (for HTML requests) or return 401 (for API/JSON requests)

#### Scenario: External WebSocket upgrade without cookie
- **WHEN** a WebSocket upgrade request arrives from a non-loopback IP with no valid auth cookie
- **THEN** the server SHALL reject the upgrade with HTTP 401

#### Scenario: External HTTP request matching bypassUrls
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL starts with an entry in `auth.bypassUrls`
- **THEN** the request SHALL proceed without authentication

#### Scenario: bypassHosts match in pair mode requires sign-in
- **WHEN** the effective trust mode is `"pair"`, `auth.bypassHosts` contains `"10.0.0.0/8"`, and an HTML request arrives from `10.0.0.5` with no auth cookie
- **THEN** the server SHALL redirect to `/auth/login`

### Requirement: OAuth login flow
The auth module SHALL implement the OAuth2 authorization code flow. The `/auth/login` route SHALL display a provider picker page listing all configured providers. If only one provider is configured, it SHALL auto-redirect to that provider's authorize URL, except for a caller that is genuinely local but neither locally trusted nor authenticated: that caller SHALL get the picker page with the `pi-dashboard open` local-proof remedy (see `trust-and-credential-boundaries` "A refused local browser is told how to authorize itself"). Every redirect to a provider's authorize URL SHALL set a short-lived, httpOnly, `SameSite=Lax` state cookie carrying an HMAC-signed copy of the `state` nonce (signing key domain-separated from the session-JWT key). A `return` value SHALL be reduced to a same-origin relative path (else `/`) before it is encoded into `state`, and the multi-provider picker SHALL propagate it to each provider link.

#### Scenario: Single provider — auto-redirect
- **WHEN** a user visits `/auth/login` and only one provider is configured
- **THEN** the server SHALL redirect to that provider's authorize URL with `client_id`, `redirect_uri`, `scope`, `state`, and `response_type=code`

#### Scenario: Multiple providers — picker page
- **WHEN** a user visits `/auth/login` and multiple providers are configured
- **THEN** the server SHALL return a server-rendered HTML page with a link/button for each provider

#### Scenario: Login with return URL
- **WHEN** a user visits `/auth/login?return=/some/path`
- **THEN** the `state` parameter SHALL encode the return URL so the callback can redirect back after login

#### Scenario: Cross-origin return URL reduced at login
- **WHEN** a user visits `/auth/login?return=https://evil.example/x` (or `//evil.example`, or a malformed percent-encoding)
- **THEN** the `state` SHALL encode `/` and the request SHALL NOT error

#### Scenario: Unproven local caller is not auto-redirected
- **WHEN** one provider is configured, `requireLocalProof` is unset, and a bare loopback browser with no proof and no session opens `/auth/login`
- **THEN** the server SHALL render the picker with the `pi-dashboard open` remedy instead of redirecting to the provider

### Requirement: OAuth callback handling
The `/auth/callback/:provider` route SHALL first verify that the `state` nonce matches the signed state cookie set at login (constant-time); a missing or mismatched cookie SHALL redirect to `/auth/login` with an error and SHALL NOT exchange the code or set a session cookie. The state cookie SHALL be cleared on every callback outcome. On a match, and before any code exchange, it SHALL refuse the login with the open-enrolment remedy page when the provider is a public provider (see "Open OAuth enrolment is refused for public providers") and both `auth.allowedUsers` and `auth.groupTiers` are empty or unset. Otherwise it SHALL exchange the authorization code for an access token, fetch the user's profile (email, display name, username), validate the user against `allowedUsers` (if configured), issue a signed JWT cookie, and redirect to the return URL re-validated as a same-origin relative path (or `/`).

The access denied page SHALL HTML-escape all user-provided data (email address, username) before interpolating into the HTML response to prevent XSS attacks. The server SHALL use an `escapeHtml()` helper that encodes `&`, `<`, `>`, `"`, and `'` as their HTML entity equivalents.

#### Scenario: Successful callback with valid code
- **WHEN** the OAuth provider redirects back with a valid `code` and a `state` matching the state cookie
- **THEN** the server SHALL exchange the code for an access token, fetch user info, set a JWT cookie, and redirect to `/`

#### Scenario: Callback with return URL in state
- **WHEN** the callback `state` matches the state cookie and contains a return URL `/sessions`
- **THEN** after successful auth, the server SHALL redirect to `/sessions` instead of `/`

#### Scenario: Callback with mismatched state
- **WHEN** the callback `state` does not match the state cookie, or no state cookie is present
- **THEN** the server SHALL redirect to `/auth/login` with an error, SHALL NOT exchange the code, and SHALL NOT set a session cookie

#### Scenario: Callback with invalid code
- **WHEN** the token exchange fails (invalid code, expired, etc.)
- **THEN** the server SHALL redirect to `/auth/login` with an error query parameter

#### Scenario: User not in allowedUsers
- **WHEN** `auth.allowedUsers` is configured and neither the user's email nor username matches any entry
- **THEN** the server SHALL return a 403 page explaining access is denied
- **AND** the email SHALL be HTML-escaped to prevent XSS

#### Scenario: Access denied — crafted email with HTML
- **WHEN** an OIDC provider returns an email like `<script>alert(1)</script>@evil.com`
- **THEN** the denied page SHALL render the escaped string `&lt;script&gt;alert(1)&lt;/script&gt;@evil.com`
- **AND** no script SHALL execute in the browser

#### Scenario: allowedUsers not configured
- **WHEN** the provider is not public (for example `keycloak` or `oidc` with an issuer outside the public IdP host set) and `auth.allowedUsers` is not set or is an empty array
- **THEN** any authenticated user of the configured issuer SHALL be allowed

#### Scenario: public provider with no enrolment bound is refused
- **WHEN** the provider is public (`github`, `google`, or an issuer on the public IdP host set), and `auth.allowedUsers` and `auth.groupTiers` are both not set or empty
- **THEN** the server SHALL return a 403 remedy page naming `auth.allowedUsers` and `auth.groupTiers`
- **AND** it SHALL NOT exchange the code, fetch user info or set a session cookie

#### Scenario: allowedUsers with email match
- **WHEN** `auth.allowedUsers` contains `user@example.com` and the user's email is `user@example.com`
- **THEN** the user SHALL be allowed

#### Scenario: allowedUsers with domain wildcard
- **WHEN** `auth.allowedUsers` contains `*@company.com` and the user's email is `user@company.com`
- **THEN** the user SHALL be allowed

#### Scenario: allowedUsers with GitHub username
- **WHEN** `auth.allowedUsers` contains `octocat` and the GitHub user's login is `octocat`
- **THEN** the user SHALL be allowed (username match, case-insensitive)

#### Scenario: allowedUsers with OIDC preferred_username
- **WHEN** `auth.allowedUsers` contains `jdoe` and the OIDC user's `preferred_username` is `jdoe`
- **THEN** the user SHALL be allowed

### Requirement: User info includes username
The `fetchUserInfo` function SHALL return `email`, `name`, and `username` for each provider. For GitHub, `username` SHALL be the `login` field. For OIDC providers, `username` SHALL be `preferred_username`. The `username` is used for access control matching against `allowedUsers`.

#### Scenario: GitHub user info includes username
- **WHEN** user info is fetched from GitHub
- **THEN** the result SHALL include `username` set to `data.login`

#### Scenario: OIDC user info includes username
- **WHEN** user info is fetched from an OIDC provider
- **THEN** the result SHALL include `username` set to `data.preferred_username` (or `data.sub` if absent)

### Requirement: JWT session token
The auth module SHALL issue a JWT signed with `auth.secret` from config. The JWT payload SHALL contain `sub` (email), `name` (display name), `username`, `provider` (provider key), and `exp` (expiry timestamp). The default expiry SHALL be 7 days. The cookie SHALL be named `pi_dash_token`, set as `HttpOnly`, `SameSite=Lax`, with the `Secure` attribute governed by "Session cookie `Secure` flag derives from the resolved base". JWT verification SHALL accept only tokens signed with HS256, the algorithm the server itself signs with; a token declaring any other algorithm (including `none`) SHALL be rejected as invalid regardless of its signature.

#### Scenario: JWT issued on successful login
- **WHEN** OAuth callback succeeds
- **THEN** a JWT with `{ sub, name, username, provider, exp }` SHALL be signed with `auth.secret` and set as cookie `pi_dash_token`

#### Scenario: Valid JWT on subsequent request
- **WHEN** an external request includes a valid, non-expired `pi_dash_token` cookie
- **THEN** the request SHALL proceed with user info available on the request

#### Scenario: Expired JWT
- **WHEN** an external request includes an expired `pi_dash_token` cookie
- **THEN** the server SHALL clear the cookie and redirect to `/auth/login`

#### Scenario: Tampered JWT
- **WHEN** an external request includes a JWT with an invalid signature
- **THEN** the server SHALL clear the cookie and return 401

#### Scenario: Token with a non-HS256 algorithm is rejected
- **WHEN** an external request includes a `pi_dash_token` cookie whose JWT header declares `alg` `none`, `HS384` or `HS512`
- **THEN** the server SHALL treat it as invalid, clear the cookie and return 401

#### Scenario: Tokens issued before the algorithm pin keep working
- **WHEN** an external request includes an unexpired HS256 `pi_dash_token` issued before this requirement took effect
- **THEN** the request SHALL proceed with user info available on the request

### Requirement: Auth secret management
The auth module SHALL use `auth.secret` from config to sign JWTs. If `auth` is configured but `auth.secret` is missing, the module SHALL auto-generate a random secret of 32 random bytes encoded as a 64-character hex string, write it back to the config file, and use it. Any existing non-empty `auth.secret`, a whitespace-only value included, SHALL be kept and used unchanged; the server SHALL NOT rotate it automatically, so existing login sessions SHALL survive an upgrade. An existing secret shorter than 32 characters, or consisting only of whitespace, SHALL additionally cause a startup warning recommending rotation, emitted at most once per process lifetime; the warning SHALL NOT contain the secret.

#### Scenario: Secret provided in config
- **WHEN** `auth.secret` is set in config
- **THEN** the module SHALL use it as the JWT signing key

#### Scenario: Secret missing — auto-generate
- **WHEN** `auth` is configured but `auth.secret` is missing
- **THEN** the module SHALL generate a random 64-character hex string (32 random bytes), persist it to `~/.pi/dashboard/config.json`, and use it

#### Scenario: Existing 32-character secret is kept
- **WHEN** `auth.secret` is an existing 32-character hex string from an earlier version
- **THEN** the module SHALL use it unchanged, SHALL NOT replace it in the config file, SHALL NOT log a warning, and previously issued session tokens SHALL still verify

#### Scenario: Whitespace-only secret is kept with a warning
- **WHEN** `auth.secret` is a non-empty value consisting only of whitespace
- **THEN** the module SHALL use it unchanged, SHALL NOT replace it, and existing sessions SHALL stay valid (no forced logout)
- **AND** the server SHALL log the rotation warning, without printing the secret

#### Scenario: Warning is emitted once per process
- **WHEN** a short existing `auth.secret` is in use and many tokens are signed and verified during one process lifetime
- **THEN** the rotation warning SHALL be logged once, not per request, and again only after a process restart

#### Scenario: Short or non-hex existing secret is kept with a warning
- **WHEN** `auth.secret` is a non-empty value shorter than 32 characters (for example a hand-set passphrase)
- **THEN** the module SHALL use it unchanged and keep existing sessions valid
- **AND** the server SHALL log one startup warning recommending rotation, without printing the secret

### Requirement: Logout
The `POST /auth/logout` route SHALL clear the `pi_dash_token` cookie and redirect to `/auth/login`.

#### Scenario: Logout clears session
- **WHEN** a POST request is made to `/auth/logout`
- **THEN** the server SHALL clear the `pi_dash_token` cookie and redirect to `/auth/login`

### Requirement: Auth status endpoint
The `GET /auth/status` route SHALL return the current authentication state. This endpoint SHALL be accessible without auth (no redirect).

#### Scenario: Authenticated user
- **WHEN** `GET /auth/status` is called with a valid JWT cookie
- **THEN** the server SHALL return `{ authenticated: true, user: { name, email, provider } }`

#### Scenario: Unauthenticated request
- **WHEN** `GET /auth/status` is called without a valid JWT cookie
- **THEN** the server SHALL return `{ authenticated: false }`

#### Scenario: Auth disabled
- **WHEN** `GET /auth/status` is called and no auth is configured
- **THEN** the server SHALL return `{ authenticated: true, authEnabled: false }`

### Requirement: OAuth redirect URI resolution
The auth module SHALL construct the OAuth `redirect_uri` from the first available base in this precedence order: the configured `auth.redirectBaseUrl` override, then the tunnel URL when available, then `http://localhost:{port}`. Trailing slashes SHALL be stripped from the resolved base. An override that is absent or an empty string SHALL be treated identically. The callback path SHALL be `/auth/callback/:provider`.

The same resolved `redirect_uri` SHALL be used by every route that mints or echoes it — the single-provider auto-redirect on `/auth/login`, `/auth/start/:provider`, and the token exchange performed by `/auth/callback/:provider`.

#### Scenario: Tunnel URL available
- **WHEN** a tunnel URL has been created (e.g., `https://abc.share.zrok.io`) and no `auth.redirectBaseUrl` is configured
- **THEN** the redirect URI SHALL be `https://abc.share.zrok.io/auth/callback/github`

#### Scenario: No tunnel — localhost fallback
- **WHEN** no tunnel is active and no `auth.redirectBaseUrl` is configured
- **THEN** the redirect URI SHALL be `http://localhost:8000/auth/callback/github`

#### Scenario: Configured override takes precedence over an active tunnel
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com` **AND** a tunnel URL `https://abc.share.zrok.io` is active
- **THEN** the redirect URI SHALL be `https://pi.example.com/auth/callback/github` and SHALL NOT contain the tunnel host

#### Scenario: Configured override with no tunnel
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com` and no tunnel is active
- **THEN** the redirect URI SHALL be `https://pi.example.com/auth/callback/github`

#### Scenario: Trailing slashes on the override are normalized
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com/` or `https://pi.example.com///`
- **THEN** the redirect URI SHALL be `https://pi.example.com/auth/callback/google` with exactly one separator

#### Scenario: Empty override falls through
- **WHEN** `auth.redirectBaseUrl` resolves to an empty string
- **THEN** resolution SHALL continue to the tunnel URL and then to `http://localhost:{port}`, and the redirect URI SHALL NOT be the relative value `/auth/callback/github`

#### Scenario: Base with a path prefix is preserved
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com/pi`
- **THEN** the redirect URI SHALL be `https://pi.example.com/pi/auth/callback/github`

#### Scenario: Authorize redirect carries the override
- **WHEN** a browser requests `GET /auth/start/github` while `auth.redirectBaseUrl` is `https://pi.example.com`
- **THEN** the `Location` response header SHALL be the provider authorize URL whose `redirect_uri` query parameter is `https://pi.example.com/auth/callback/github`

#### Scenario: Token exchange echoes the same URI
- **WHEN** the provider calls back to `/auth/callback/:provider` with an authorization code while `auth.redirectBaseUrl` is set
- **THEN** the `redirect_uri` sent to the provider token endpoint SHALL be byte-identical to the one sent to the authorize endpoint

### Requirement: Redirect base override is reapplied on runtime auth reload
When the auth configuration is reloaded at runtime via `PUT /api/config`, the auth plugin SHALL reassign its in-memory redirect base from the reloaded configuration, so a changed or cleared `auth.redirectBaseUrl` takes effect on the next OAuth request without a server restart.

This reload path is only installed when the server booted with at least one resolvable OAuth provider; when the boot-time provider registry is empty the auth plugin registers no routes and no reload hook, and a restart is required for any auth configuration change to take effect.

#### Scenario: Override changed at runtime
- **WHEN** the server is running with `auth.redirectBaseUrl` = `https://old.example.com` and a `PUT /api/config` sets it to `https://new.example.com`
- **THEN** the next `GET /auth/start/github` SHALL emit a `redirect_uri` of `https://new.example.com/auth/callback/github` without a restart

#### Scenario: Override cleared at runtime
- **WHEN** a `PUT /api/config` sets `auth.redirectBaseUrl` to an empty string (omitting the key preserves it instead — see the partial-write scenario below)
- **THEN** the next `GET /auth/start/github` SHALL fall back to the tunnel URL, or to `http://localhost:{port}` when no tunnel is active

#### Scenario: Unrelated partial write preserves the override
- **WHEN** a `PUT /api/config` writes an unrelated `auth` field (for example `allowedUsers`) without including `redirectBaseUrl`
- **THEN** the persisted configuration SHALL retain the existing `auth.redirectBaseUrl` value

#### Scenario: No providers at boot
- **WHEN** the server booted with an empty resolvable provider registry and `auth.redirectBaseUrl` is added via `PUT /api/config`
- **THEN** no `/auth/*` route exists to observe the change and the value SHALL take effect only after a server restart

### Requirement: Redirect base misconfiguration is reported
When `auth.redirectBaseUrl` is set to a value that is not an absolute `http` or `https` origin without query or fragment, the server SHALL log a warning that names the `auth.redirectBaseUrl` field and the offending value, at plugin registration and at every auth reload. The value SHALL still be used — the system SHALL NOT silently discard it — so that the operator observes the misconfiguration rather than an unexplained fallback.

#### Scenario: Missing scheme
- **WHEN** `auth.redirectBaseUrl` is `pi.example.com`
- **THEN** the server SHALL log a warning naming the field and the value, and SHALL still build `pi.example.com/auth/callback/github`

#### Scenario: Non-http scheme
- **WHEN** `auth.redirectBaseUrl` is `ftp://pi.example.com` or `javascript:alert(1)`
- **THEN** the server SHALL log a warning naming the field and the value

#### Scenario: Query or fragment present
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com?tenant=a` or `https://pi.example.com#x`
- **THEN** the server SHALL log a warning naming the field and the value

#### Scenario: Valid origin is silent
- **WHEN** `auth.redirectBaseUrl` is `https://pi.example.com` or `https://pi.example.com/pi`
- **THEN** the server SHALL NOT log any redirect-base warning

### Requirement: `publicBaseUrls` is not an OAuth source
Redirect-base resolution SHALL read the operator-stated scalar `auth.redirectBaseUrl` only. The `publicBaseUrls` list — top-level or legacy — SHALL NOT be promoted to a redirect-base tier, in any arity and under any gating rule.

The two keys differ in **arity**, not in meaning: `publicBaseUrls` is every address the dashboard answers on, while an OAuth `redirect_uri` must be one origin pre-registered byte-for-byte with the provider. With a list there is no non-arbitrary way to derive the scalar, so the operator states it.

#### Scenario: A single https entry does not become the redirect base
- **WHEN** `publicBaseUrls` holds exactly one `https:` entry, `auth.redirectBaseUrl` is unset, and a tunnel is active
- **THEN** the redirect URI SHALL be derived from the tunnel URL

#### Scenario: A single https entry does not beat the localhost fallback either
- **WHEN** `publicBaseUrls` holds exactly one `https:` entry, `auth.redirectBaseUrl` is unset, and no tunnel is active
- **THEN** the redirect URI SHALL be `http://localhost:{port}/auth/callback/{provider}`

### Requirement: Provider deletion route
The server SHALL expose `DELETE /api/config/auth/providers/:id`, behind the same network guard and auth gate as `PUT /api/config`, removing exactly one key from `auth.providers` and triggering the same runtime auth reload as any other config write.

The route SHALL use a raw read/write helper rather than the partial-write merge (whose spread-only providers merge cannot express a removal) and rather than the redaction path (which would persist the redaction placeholder over every surviving provider's real `clientSecret`).

Deletion SHALL be idempotent: deleting an absent provider is a success with no write and no reload.

Deleting the LAST remaining provider SHALL be refused unless `?force=true` is supplied, and the refusal SHALL state the consequence: the request gate stays installed and `/auth/login` lists no way to sign in, so this is auth **enforced with no login path**, not auth disabled, and it can lock out every remote operator until the server is restarted.

#### Scenario: One of several providers deleted
- **WHEN** two providers are configured and one is deleted
- **THEN** only that key SHALL be removed, the surviving provider's real `clientSecret` SHALL remain on disk unredacted, and the auth reload SHALL run

#### Scenario: Absent provider
- **WHEN** the named provider does not exist
- **THEN** the response SHALL be a success reporting no deletion, the config file SHALL be untouched, and no reload SHALL run

#### Scenario: Last provider without force
- **WHEN** exactly one provider is configured and it is deleted without `?force=true`
- **THEN** the request SHALL be refused, the response SHALL state the lockout consequence, and the provider SHALL remain configured

#### Scenario: Last provider with force
- **WHEN** the same request carries `?force=true`
- **THEN** the provider SHALL be removed, the request gate SHALL still refuse unauthenticated requests, and `/auth/login` SHALL list zero providers

#### Scenario: Unauthenticated caller
- **WHEN** an unauthenticated non-loopback caller issues the request
- **THEN** it SHALL be rejected by the same guard that rejects `PUT /api/config`

### Requirement: Session cookie `Secure` flag derives from the resolved base
The session cookie and the OAuth state cookie SHALL be marked `Secure` when ANY of these holds: the RESOLVED redirect base is `https:`; the request's own socket is TLS; or the request's socket peer is a loopback address AND its `Host` header names a live `https` tunnel origin. The decision SHALL be evaluated per request, on the socket peer address and never on a forwarding header, so header-injecting tunnels qualify exactly as header-free ones do. A tunnel origin qualifies only when its scheme is `https`, and the `Host` matches it on BOTH host and port, compared in the canonical form of the shared canonical-origin helper (case-insensitive host, default port `:443` equal to no port, trailing dot ignored). A live tunnel origin with a non-`https` scheme, or a `Host` whose port differs, SHALL NOT qualify. The cookie SHALL NOT be marked `Secure` otherwise. A forged `Host` header can only make the cookie stricter, never grant access. Both cookies SHALL be set by code that receives the request, so this evaluation is available at the point each cookie is issued.

The flag SHALL NOT be derived from `request.protocol` or from any forwarding header (`X-Forwarded-Proto`, `Forwarded`), and Fastify's `trustProxy` SHALL NOT be enabled to make that work. `request.ip` is what both authorization bypasses read (the auth-gate bypass and the network guard), so trusting `X-Forwarded-For` would make both gates header-forgeable and would split REST from the WebSocket upgrade path, which authorizes on the socket peer.

#### Scenario: Behind a TLS reverse proxy
- **WHEN** the resolved redirect base is `https://pi.example.com` and the request arrives over plain http on the loopback hop
- **THEN** the session cookie SHALL be marked `Secure`

#### Scenario: Plain-http deployment
- **WHEN** the resolved base is a plain `http:` origin, the request socket is not TLS, and the request is not a loopback hop for a live https tunnel origin
- **THEN** the cookie SHALL NOT be marked `Secure`

#### Scenario: Https tunnel with an http redirect base
- **WHEN** an https tunnel is live, the resolved base is a plain `http:` origin, and a loopback-peer request arrives whose `Host` is the tunnel's public host
- **THEN** the session cookie SHALL be marked `Secure`

#### Scenario: Tunnel URL not yet resolved into the base
- **WHEN** a tunnel is live but the resolved base was computed before its URL was known, and a loopback-peer request arrives with that tunnel's host in `Host`
- **THEN** the cookie SHALL be marked `Secure`

#### Scenario: Header-injecting tunnel still qualifies by socket peer
- **WHEN** a live https tunnel (such as zrok or cloudflared) forwards a request to the loopback listener with forwarding headers present, the socket peer is loopback and `Host` names the tunnel's public host
- **THEN** the cookie SHALL be marked `Secure`
- **AND** the decision SHALL rest on the socket peer being a loopback address, not on whether the request is otherwise genuinely local

#### Scenario: Tunnel host from a non-loopback peer
- **WHEN** a request from a non-loopback peer carries a `Host` naming a live tunnel origin over plain http and the resolved base is `http:`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Non-https tunnel origin never qualifies
- **WHEN** a live tunnel origin has scheme `http:` and a loopback-peer request arrives with that tunnel's host in `Host` while the resolved base is `http:`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Host port mismatch does not qualify
- **WHEN** the live https tunnel origin is `https://pi.share.example` and a loopback-peer request carries `Host: pi.share.example:8443`
- **THEN** the cookie SHALL NOT be marked `Secure` by the tunnel rule

#### Scenario: Case and trailing-dot variants of the tunnel host qualify
- **WHEN** a loopback-peer request carries `Host: PI.share.example.` for the live https tunnel origin `https://pi.share.example`
- **THEN** the cookie SHALL be marked `Secure`

#### Scenario: Forwarded protocol header never sets Secure
- **WHEN** a plain-http request on the resolved `http:` base carries `X-Forwarded-Proto: https` and no live tunnel origin matches
- **THEN** the cookie SHALL NOT be marked `Secure`

#### Scenario: Forwarding headers never grant trust
- **WHEN** a request from an untrusted peer carries `X-Forwarded-For` naming a trusted-network address
- **THEN** authorization SHALL still evaluate the socket peer and the request SHALL be refused

### Requirement: Resolved redirect base is diagnosable
The server SHALL expose the resolved redirect base and the tier that produced it on a guarded runtime endpoint, and SHALL mirror the same information to the server log at every auth registration and reload.

The endpoint SHALL remain guarded (it discloses the deployment's public origin) but SHALL be reachable over loopback without a JWT, because an operator whose OAuth is broken cannot obtain one remotely. When the server booted with an empty resolvable provider registry, the endpoint SHALL report `authActive: false` rather than a boot-frozen value that appears live.

#### Scenario: Reports base and tier
- **WHEN** `auth.redirectBaseUrl` is set and the endpoint is queried over loopback
- **THEN** the response SHALL carry that value as the resolved base with the source `auth.redirectBaseUrl`

#### Scenario: Rejected for an unauthenticated remote caller
- **WHEN** an unauthenticated non-loopback caller queries the endpoint
- **THEN** it SHALL be refused by the network guard

#### Scenario: Log line at register and reload
- **WHEN** the auth plugin registers, and again on every runtime reload
- **THEN** exactly one log line SHALL name the resolved base and its tier

### Requirement: Session tier claim
The session JWT SHALL carry an optional `tier` claim (`observe`, `control`, or
`operate`). When validating a session, the auth module SHALL set the request's
principal tier from the claim, so the existing route-tier gate applies to
cookie sessions exactly as it does to paired-device bearers. A valid JWT
without a `tier` claim SHALL be treated as `operate`, preserving the access of
sessions issued before this change. Loopback, genuine-local, and trusted
bypass paths SHALL be unaffected.

#### Scenario: Observe session refused on an operate route
- **GIVEN** a session JWT with `tier: "observe"`
- **WHEN** it calls a route whose tier is `operate`
- **THEN** the route-tier gate SHALL refuse the request

#### Scenario: Legacy JWT keeps full access
- **GIVEN** a valid session JWT issued without a `tier` claim
- **WHEN** it calls a route whose tier is `operate`
- **THEN** the request SHALL be allowed

### Requirement: OIDC groups map to a tier
The auth module SHALL accept an optional `auth.groupTiers` map from group name
to tier. When it is configured, on OIDC callback the module SHALL read the
`groups` claim from the ID token or userinfo response and issue the session
with the highest tier among the matching groups. When `auth.groupTiers` is
configured and no group matches, login SHALL be refused. When it is not
configured, login SHALL behave as before (`allowedUsers` check, `operate`
tier), except that a public provider with both `auth.allowedUsers` and
`auth.groupTiers` empty or unset SHALL be refused (see "Open OAuth enrolment is
refused for public providers"). A tier derived from groups SHALL hold until the JWT
expires.

#### Scenario: Highest matching group wins
- **GIVEN** `auth.groupTiers` = `{ "dash-view": "observe", "dash-ops": "operate" }`
- **WHEN** a user whose `groups` claim is `["dash-view", "dash-ops"]` completes OIDC login
- **THEN** the session JWT SHALL carry `tier: "operate"`

#### Scenario: No matching group is refused
- **GIVEN** `auth.groupTiers` is configured
- **WHEN** a user whose `groups` claim matches none of its keys completes OIDC login
- **THEN** no session SHALL be issued and the user SHALL see an access-denied page

#### Scenario: Unconfigured map keeps legacy behaviour
- **GIVEN** `auth.groupTiers` is not configured and the provider is not public, or `auth.allowedUsers` is set
- **WHEN** an allowed user completes OIDC login
- **THEN** the session SHALL be issued with tier `operate`

#### Scenario: Unconfigured map on a public provider with no allowlist is refused
- **GIVEN** `auth.groupTiers` and `auth.allowedUsers` are both not configured and the provider is public
- **WHEN** a user attempts OIDC login
- **THEN** no session SHALL be issued and the user SHALL see the open-enrolment remedy page

### Requirement: Session tier applies to the browser WebSocket
A browser WebSocket admitted by a login-session cookie SHALL carry the
session's live tier. Each browser-to-server message type SHALL map to a
required tier (unlisted types SHALL require `operate`), and a message above the
socket's tier SHALL be dropped without being dispatched. A terminal socket SHALL
require `operate` and a live-preview socket SHALL require `control`; the
live-preview HTTP proxy (`/live/*`) SHALL require `control` for a tiered
session as well. A passkey
user who is revoked SHALL have their open socket closed on its next message.
Sockets admitted by genuine-local, trusted-network, or ticket paths SHALL NOT
be tier-gated.

#### Scenario: Observe socket cannot prompt
- **GIVEN** a browser socket admitted by a session JWT with tier `observe`
- **WHEN** it sends `send_prompt`
- **THEN** the message SHALL NOT be dispatched

#### Scenario: Control socket cannot open a terminal
- **GIVEN** a session with tier `control`
- **WHEN** it opens a terminal WebSocket
- **THEN** the upgrade SHALL be refused with 403

#### Scenario: Revoked passkey user's socket closes
- **GIVEN** a passkey user with an open browser socket
- **WHEN** an operator revokes the user and the socket sends any message
- **THEN** the server SHALL close the socket

### Requirement: CSP report sink is public to the OAuth gate
The OAuth `onRequest` gate SHALL treat `POST /__pi/csp-report/:policy` as a public path, so violation reports from signed-out pages (the login and passkey pages) are neither redirected to `/auth/login` nor refused. The exemption SHALL cover only that method and path pattern; it SHALL NOT widen any other route. See the `baseline-content-security-policy` capability for the sink's own limits.

#### Scenario: Signed-out report is not redirected
- **WHEN** OAuth is configured and a request with no cookie posts a report to `/__pi/csp-report/strict`
- **THEN** the OAuth gate SHALL NOT redirect or refuse it

#### Scenario: Exemption is narrow
- **WHEN** OAuth is configured and a request with no cookie sends `GET /__pi/csp-report/strict` or posts to another `/__pi/` path
- **THEN** the OAuth gate SHALL apply as for any non-public path

### Requirement: Public providers are classified from configuration, not from the key alone or from discovery
A provider SHALL be *public* when its key is `github` or `google`, or when the host of its configured `issuerUrl` exactly matches the fixed public-IdP host set; every other issuer SHALL be non-public, including an `issuerUrl` that cannot be parsed into a host (such a provider cannot complete login, because discovery fails). Classification SHALL use configuration only and SHALL NOT depend on OIDC discovery.

#### Scenario: The fixed host set and its comparison
- **WHEN** an issuer host is compared
- **THEN** the set SHALL be `accounts.google.com`, `github.com`, `gitlab.com`, `appleid.apple.com` and `login.microsoftonline.com` with the first path segment `common`, `consumers` or `organizations`
- **AND** the comparison SHALL lowercase the host, ignore the port and one trailing dot, and never match by suffix

#### Scenario: Public issuer under an arbitrary provider key is public
- **WHEN** a provider keyed `oidc` has `issuerUrl` `https://accounts.google.com`
- **THEN** it SHALL be classified public

#### Scenario: Subdomain lookalike is not public
- **WHEN** a provider's issuer host is `accounts.google.com.evil.example` or `sso.github.com`
- **THEN** it SHALL be classified non-public

#### Scenario: Unparseable issuerUrl is non-public
- **WHEN** a provider keyed `oidc` has `issuerUrl` `not a url`, `//` or an empty string
- **THEN** it SHALL be classified non-public, because there is no host to match

#### Scenario: Failed discovery does not change the classification
- **WHEN** a provider keyed `oidc` with `issuerUrl` `https://accounts.google.com` is configured, its OIDC discovery fails at registration, and `auth.allowedUsers` and `auth.groupTiers` are empty
- **THEN** it SHALL still be classified public and in open enrolment
- **AND** a session JWT whose provider claim is `oidc` SHALL be rejected, and the provider SHALL still be reported by `GET /api/auth/diagnostics` and warned about in the log

### Requirement: Open OAuth enrolment is refused for public providers
A provider is in *open enrolment* when `auth.allowedUsers` and `auth.groupTiers` are both empty or unset. For a public provider in open enrolment the server SHALL refuse login at `/auth/login`, `/auth/start/:provider` and `/auth/callback/:provider` on the live configuration, with a remedy page naming both fields and echoing no identity. Other issuers and passkeys are unaffected.

#### Scenario: GitHub with no allowlist is refused at login start
- **WHEN** `auth.providers.github` is configured, `auth.allowedUsers` and `auth.groupTiers` are empty, and a caller requests `/auth/start/github`
- **THEN** the server SHALL return the 403 remedy page and SHALL NOT redirect to the provider

#### Scenario: Public issuer under an arbitrary provider key is refused
- **WHEN** a provider keyed `oidc` has `issuerUrl` `https://accounts.google.com`, and `auth.allowedUsers` and `auth.groupTiers` are empty
- **THEN** `/auth/start/oidc` and `/auth/callback/oidc` SHALL return the 403 remedy page without contacting the provider's token endpoint

#### Scenario: Microsoft common tenant is public, a specific tenant is not
- **WHEN** a provider's issuer is `https://login.microsoftonline.com/common/v2.0` with empty allowlist and groups
- **THEN** login SHALL be refused
- **AND** an issuer `https://login.microsoftonline.com/<tenant-guid>/v2.0` SHALL be treated as non-public (allow-all with a warning)

#### Scenario: Unknown issuer keeps allow-all with a warning
- **WHEN** a provider keyed `keycloak` has issuer `https://sso.example.com/realms/acme` with empty allowlist and groups
- **THEN** login SHALL continue to be admitted at `operate`
- **AND** one warning line SHALL be logged at registration and at each reload

#### Scenario: Single-provider auto-redirect is also refused
- **WHEN** `github` is the only provider, in open enrolment, and a caller requests `/auth/login`
- **THEN** the server SHALL NOT auto-redirect to the provider
- **AND** it SHALL return the 403 remedy page

#### Scenario: Picker shows the refused provider with a note
- **WHEN** a passkey is enabled or several providers are configured, and one public provider is in open enrolment
- **THEN** the login page SHALL list that provider without a sign-in link and with a "not configured for sign-in" note naming `auth.allowedUsers` and `auth.groupTiers`
- **AND** the note SHALL be text, not colour alone

#### Scenario: Callback refuses before exchange
- **WHEN** a callback for `google` in open enrolment arrives with a valid state cookie
- **THEN** the server SHALL return the 403 remedy page without exchanging the code or fetching user info

#### Scenario: Adding an allowlist re-enables login
- **WHEN** an operator sets `auth.allowedUsers` to `["octocat"]` and the config is reloaded
- **THEN** a GitHub login for `octocat` SHALL succeed without a server restart
- **AND** a GitHub login for any other account SHALL be refused with the access-denied page

#### Scenario: groupTiers alone lifts the open-enrolment refusal
- **WHEN** `auth.groupTiers` is configured and `auth.allowedUsers` is empty for a public provider
- **THEN** the open-enrolment refusal SHALL NOT apply
- **AND** the existing group-tier rules SHALL decide the login

### Requirement: Sessions of refused or removed providers are rejected
A session JWT SHALL be rejected on every request when its `provider` claim is unusable (missing, empty, non-string), its key is absent from `auth.providers`, or its provider is public and in open enrolment. A discovery outage alone SHALL NOT reject a non-public provider's sessions. A reload that refuses or removes a provider SHALL synchronously close the browser and terminal WebSockets it admitted with the session-revoked code; the scenarios pin sweep failure and logging.

#### Scenario: Already-issued session of a refused provider is rejected
- **GIVEN** a valid session JWT whose `provider` claim is `github`, issued before the upgrade
- **WHEN** `github` is a public provider in open enrolment and the browser sends that cookie on any REST request
- **THEN** the server SHALL clear the session cookie and answer 401 (or redirect an HTML request with 302 to `/auth/login?return=<encoded url>`, the same redirect an unauthenticated HTML request receives; the login page then states the remedy)
- **AND** `GET /auth/status` SHALL report unauthenticated and a WebSocket upgrade with that cookie SHALL be refused

#### Scenario: Session of a provider removed from configuration is rejected
- **GIVEN** a valid session JWT whose `provider` claim is `corp-oidc` (or `github`)
- **WHEN** that key is no longer in `auth.providers` and the browser sends that cookie
- **THEN** the server SHALL clear the cookie and answer 401 (or redirect an HTML request to `/auth/login`), whatever the allowlist contains

#### Scenario: Discovery outage does not revoke a non-public provider's sessions
- **GIVEN** a valid session JWT whose `provider` claim is `keycloak`, still configured with a non-public issuer, and a reload at which its OIDC discovery failed
- **WHEN** the browser sends that cookie
- **THEN** the session SHALL remain valid

#### Scenario: Reload closes the open sockets of a refused provider
- **GIVEN** an open browser WebSocket and an open terminal WebSocket admitted by a `github` session cookie
- **WHEN** an authentication reload leaves `github` public with empty `auth.allowedUsers` and `auth.groupTiers`
- **THEN** both sockets SHALL be closed with the session-revoked close code without waiting for another inbound frame
- **AND** sockets admitted by passkey sessions, device tickets or genuine-local trust SHALL stay open

#### Scenario: Session JWT without a usable provider claim is rejected
- **GIVEN** a validly signed session JWT with no `provider` claim, with `provider` set to the empty string, or with `provider` set to a non-string value
- **WHEN** the browser sends that cookie on any REST request
- **THEN** the server SHALL clear the cookie and answer 401, and SHALL NOT treat the token as a legacy token the way a missing `tier` claim is

#### Scenario: Reload that removes the last provider still closes the sockets
- **GIVEN** open browser and terminal WebSockets admitted by a `github` session cookie
- **WHEN** a reload removes every provider and authentication becomes inactive
- **THEN** both sockets SHALL be closed with the session-revoked code, as for any removed provider

#### Scenario: Sweep is synchronous and its failure does not fail the reload
- **WHEN** the end-of-reload sweep runs
- **THEN** each target socket SHALL have its close issued before the reload returns, with no inbound frame needed
- **AND** if the sweep throws, the error SHALL be logged at error level and the reloaded configuration SHALL stay applied

#### Scenario: One aggregate log line per sweep
- **WHEN** a sweep closes N > 0 sockets
- **THEN** exactly one line SHALL be logged carrying N and both per-gateway counts and no provider or user identity
- **AND** when N is 0 no line SHALL be logged

#### Scenario: Terminal sockets carry the session tier from the upgrade
- **WHEN** a terminal WebSocket is admitted by a login-session cookie
- **THEN** the socket SHALL carry the session's live tier from the upgrade, so a later revocation or provider refusal closes it

#### Scenario: Live-preview sockets are a documented residual
- **WHEN** a reload refuses a provider whose cookie admitted an open live-preview socket
- **THEN** that socket MAY stay open until its ticket expires, because it is capability-URL scoped and not session-tier
- **AND** the same cookie SHALL NOT open a new live-preview socket

#### Scenario: Passkey and bearer sessions are not rejected
- **WHEN** a passkey session or a device bearer is presented while an OAuth provider is in open enrolment
- **THEN** it SHALL be validated exactly as before

#### Scenario: Allowlist edits do not revoke issued tokens of allowed open providers
- **WHEN** an operator edits `auth.allowedUsers` while a session JWT of a still-allowed provider exists
- **THEN** that JWT SHALL remain valid until it expires (documented residual, out of scope)

### Requirement: Open OAuth enrolment is surfaced and its refusal audited
Every configured provider in open enrolment SHALL get a warning at registration and each reload, an `openEnrolment` entry in `GET /api/auth/diagnostics` (from live state) and a Settings Security banner. A refusal SHALL be audited with the provider key and socket-peer IP only. The warning for a refused provider SHALL tell the operator to review Settings ▸ Users and Paired devices.

#### Scenario: Unknown-issuer providers keep allow-all with a warning
- **WHEN** `keycloak` or `oidc` with an issuer outside the public set is configured with empty `allowedUsers` and `groupTiers`
- **THEN** login SHALL continue to be admitted at `operate`
- **AND** one warning line naming the provider and the two fields SHALL be logged at registration and at each reload
- **AND** `GET /api/auth/diagnostics` SHALL list the provider under `openEnrolment` with mode `open`

#### Scenario: Refused public provider is reported with mode refused
- **WHEN** a public provider is in open enrolment
- **THEN** `GET /api/auth/diagnostics` SHALL list it under `openEnrolment` with mode `refused`

#### Scenario: Warning for a refused provider names the post-upgrade review
- **WHEN** a public provider in open enrolment is registered or reloaded
- **THEN** the warning line SHALL name the provider and the two fields
- **AND** it SHALL tell the operator to review Settings ▸ Users and Settings ▸ Paired devices for entries created while sign-in was open

#### Scenario: Diagnostics reflect live state, not the config file
- **WHEN** `config.json` has been edited to add an allowlist but the reload has not been applied
- **THEN** `GET /api/auth/diagnostics` SHALL still report the provider set that the running authentication state enforces
- **AND** when authentication is inactive the field SHALL be an empty list

#### Scenario: Banner in Settings
- **WHEN** a provider is in open enrolment and an operator opens Settings → Security
- **THEN** a banner SHALL name the provider and say whether login is refused (public provider) or open to every issuer account (other issuers)

#### Scenario: Banner and diagnostics are operator-facing
- **WHEN** a caller below the `operate` tier requests `GET /api/auth/diagnostics`
- **THEN** the request SHALL be refused as for any `operate` route, and no banner SHALL be shown to that caller
- **AND** no tier SHALL be changed for the banner: it reaches exactly the callers who can read that route, because Security settings are operator-facing

#### Scenario: A discovery-failed provider is still surfaced
- **WHEN** a configured provider in open enrolment failed its OIDC discovery and is absent from the login picker
- **THEN** it SHALL still be warned about at registration and reload and listed under `openEnrolment`

#### Scenario: Refusal is audited without identity
- **WHEN** a login is refused for open enrolment
- **THEN** one audit line SHALL name the provider key and the socket-peer IP
- **AND** it SHALL NOT contain any email, username, code or token
