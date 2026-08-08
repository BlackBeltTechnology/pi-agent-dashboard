## MODIFIED Requirements

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

## ADDED Requirements

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
The session cookie SHALL be marked `Secure` when the RESOLVED redirect base is `https:`, and SHALL NOT be marked `Secure` otherwise.

The flag SHALL NOT be derived from `request.protocol`, and Fastify's `trustProxy` SHALL NOT be enabled to make that work. `request.ip` is what both authorization bypasses read (the auth-gate bypass and the network guard), so trusting `X-Forwarded-For` would make both gates header-forgeable and would split REST from the WebSocket upgrade path, which authorizes on the socket peer.

#### Scenario: Behind a TLS reverse proxy
- **WHEN** the resolved redirect base is `https://pi.example.com` and the request arrives over plain http on the loopback hop
- **THEN** the session cookie SHALL be marked `Secure`

#### Scenario: Plain-http deployment
- **WHEN** the resolved base is a plain `http:` origin
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
