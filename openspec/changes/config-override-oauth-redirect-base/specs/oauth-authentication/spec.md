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
- **WHEN** a `PUT /api/config` removes `auth.redirectBaseUrl` or sets it to an empty string
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
