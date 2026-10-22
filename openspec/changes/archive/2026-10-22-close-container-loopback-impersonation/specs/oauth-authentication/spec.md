## MODIFIED Requirements

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
