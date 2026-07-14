## ADDED Requirements

### Requirement: Browser-based Google OAuth login
The system SHALL provide a Google OAuth provider that authenticates a user through the system browser using the OAuth 2.0 authorization-code flow with PKCE and a loopback (`127.0.0.1`) redirect, returning credentials pi persists as `{ type: "oauth", refresh, access, expires }`. The provider SHALL NOT automate the Google login form and SHALL NOT attempt to mint a static API-key string.

#### Scenario: Successful loopback login
- **WHEN** the user starts login for the Google provider and completes consent in the system browser
- **THEN** the provider's loopback callback server receives the authorization code, exchanges it (with the PKCE verifier) for tokens, and returns `{ refresh, access, expires }` that pi stores under `type: "oauth"`

#### Scenario: State/PKCE mismatch is rejected
- **WHEN** the callback `state` parameter does not match the value issued at authorization start
- **THEN** the provider rejects the login with an error and does not exchange the code or persist any credential

### Requirement: Remote/tunnel manual-code fallback
The provider SHALL set `usesCallbackServer` and support manual authorization-code entry so login succeeds when the browser runs on a different machine than pi (dashboard remote / Docker / tunnel case).

#### Scenario: Browser on another machine
- **WHEN** pi runs behind a tunnel and the loopback redirect cannot reach the pi host
- **THEN** the user can paste the full redirect URL or authorization code, and the provider parses the code + state, validates state, and completes the token exchange

### Requirement: Bearer-token Gemini requests
The provider's `getApiKey(credentials)` SHALL return the OAuth access token so pi sends `Authorization: Bearer <access>` on Gemini model requests, and `modifyModels` SHALL pin the Gemini model `baseUrl` to the selected Google API surface.

#### Scenario: Authenticated model call
- **WHEN** a Gemini model request is made while a valid Google OAuth credential exists
- **THEN** pi issues the request to the configured Gemini baseUrl with the access token as a Bearer credential and receives a successful response

### Requirement: Automatic token refresh
The provider SHALL implement `refreshToken(credentials)` so pi transparently renews the ~1-hour access token from the stored refresh token without re-opening the browser, until the refresh token is revoked or expires.

#### Scenario: Expired access token
- **WHEN** the stored access token is expired but the refresh token is still valid
- **THEN** pi calls `refreshToken`, obtains a new access token + expiry, re-stores the credential, and the pending request proceeds without user interaction

### Requirement: Registration through the existing provider path
The Google OAuth provider SHALL be registered via the dashboard extension's existing `registerProvider({ ..., oauth })` call so pi surfaces it in `/login`, `list_models` (`hasOAuth`, `expires`), and the settings UI without new bespoke storage or UI plumbing.

#### Scenario: Provider appears in login and model introspection
- **WHEN** the extension registers the Google provider with an `oauth` config
- **THEN** the Google option is offered by pi's `/login`, and `list_models` reports the provider with `hasOAuth: true` and its credential expiry once authenticated
