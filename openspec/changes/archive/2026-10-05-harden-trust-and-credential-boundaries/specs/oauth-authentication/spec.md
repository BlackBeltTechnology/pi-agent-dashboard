## MODIFIED Requirements

### Requirement: Localhost and trusted host bypass
The auth module SHALL skip authentication entirely for requests originating from loopback addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). Additionally, if `auth.bypassUrls` is configured, the auth module SHALL skip authentication for HTTP requests whose URL starts with any entry in that list. If `auth.bypassHosts` is configured, the auth module SHALL skip authentication for requests originating from any matching IP (exact, wildcard, or CIDR). All bypass rules apply before any cookie/session validation, for both HTTP requests and WebSocket upgrades.


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: Localhost HTTP request without cookie
- **WHEN** `requireLocalProof` is disabled and an HTTP request arrives from `127.0.0.1` with no auth cookie
- **THEN** the request SHALL proceed without authentication

#### Scenario: Localhost WebSocket upgrade without cookie
- **WHEN** `requireLocalProof` is disabled and a WebSocket upgrade request arrives from `::1` with no auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: External HTTP request without cookie
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL does not match any `bypassUrls` entry
- **THEN** the server SHALL redirect to `/auth/login` (for HTML requests) or return 401 (for API/JSON requests)

#### Scenario: External WebSocket upgrade without cookie
- **WHEN** a WebSocket upgrade request arrives from a non-loopback IP with no valid auth cookie
- **THEN** the server SHALL reject the upgrade with HTTP 401

#### Scenario: External HTTP request matching bypassUrls
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL starts with an entry in `auth.bypassUrls`
- **THEN** the request SHALL proceed without authentication

### Requirement: OAuth login flow
The auth module SHALL implement the OAuth2 authorization code flow. The `/auth/login` route SHALL display a provider picker page listing all configured providers. If only one provider is configured, it SHALL auto-redirect to that provider's authorize URL. Every redirect to a provider's authorize URL SHALL set a short-lived, httpOnly, `SameSite=Lax` state cookie carrying an HMAC-signed copy of the `state` nonce (signing key domain-separated from the session-JWT key). A `return` value SHALL be reduced to a same-origin relative path (else `/`) before it is encoded into `state`, and the multi-provider picker SHALL propagate it to each provider link.

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

### Requirement: OAuth callback handling
The `/auth/callback/:provider` route SHALL first verify that the `state` nonce matches the signed state cookie set at login (constant-time); a missing or mismatched cookie SHALL redirect to `/auth/login` with an error and SHALL NOT exchange the code or set a session cookie. The state cookie SHALL be cleared on every callback outcome. On a match it SHALL exchange the authorization code for an access token, fetch the user's profile (email, display name, username), validate the user against `allowedUsers` (if configured), issue a signed JWT cookie, and redirect to the return URL re-validated as a same-origin relative path (or `/`).

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
- **WHEN** `auth.allowedUsers` is not set or is an empty array
- **THEN** any authenticated user SHALL be allowed

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
