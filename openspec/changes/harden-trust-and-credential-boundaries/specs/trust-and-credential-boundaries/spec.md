## ADDED Requirements

### Requirement: Login OAuth flow is CSRF-protected and returnUrl is constrained
The dashboard login OAuth flow SHALL bind its state parameter to a short-lived
signed cookie and SHALL reject a callback whose state does not match the cookie.
The post-login `returnUrl` SHALL be constrained to same-origin relative paths; an
absolute or cross-origin `returnUrl` SHALL NOT be used for redirection.

#### Scenario: mismatched state rejected
- **WHEN** an OAuth callback arrives whose state does not match the state cookie
- **THEN** the login SHALL be rejected (no session issued)

#### Scenario: cross-origin returnUrl neutralized
- **WHEN** login is initiated with `return=https://evil.example/steal`
- **THEN** the post-login redirect SHALL NOT navigate to the cross-origin URL

#### Scenario: normal login succeeds
- **WHEN** a valid OAuth callback matches the state cookie and `returnUrl` is a same-origin path
- **THEN** the session SHALL be issued and the user redirected to that path

### Requirement: Bare loopback is not sufficient for dangerous routes
The dangerous code-exec routes (terminal, session, git) SHALL require genuine-local
proof (the local-token) rather than trusting a bare-loopback socket peer alone, so
a marker-less reverse tunnel terminating on loopback cannot inherit host trust.
Requests carrying a valid local-token or another accepted credential SHALL still
pass.

#### Scenario: marker-less loopback tunnel denied on a dangerous route
- **WHEN** a request to a terminal/session/git route arrives from `127.0.0.1` with no local-token and no other credential (a marker-less relay)
- **THEN** the request SHALL be denied

#### Scenario: genuine-local desktop flow allowed
- **WHEN** the same-desktop client presents a valid local-token
- **THEN** the request SHALL be allowed

### Requirement: Bridge event emission is restricted to an allowlist
The bridge `plugin_emit_event` handler SHALL emit only event names on an explicit
allowlist of dashboard-plugin events, and SHALL drop any event whose name is not
on the allowlist. Payloads SHALL still be delivered only for allowlisted events.

#### Scenario: unknown event dropped
- **WHEN** `plugin_emit_event` is received with an event name not on the allowlist
- **THEN** the bridge SHALL NOT emit it internally

#### Scenario: allowlisted event delivered
- **WHEN** `plugin_emit_event` is received with an allowlisted dashboard-plugin event name
- **THEN** the bridge SHALL emit it as before

### Requirement: Secret-bearing config file is written 0600
The config file that holds the auth HMAC secret (`config.json`) SHALL be written
with `0600` permissions, so other local users cannot read the secret. This applies
to every write path (initial creation and update).

#### Scenario: config file mode on write
- **WHEN** the server writes or updates `config.json`
- **THEN** the file mode SHALL be `0600`

#### Scenario: secret not world-readable
- **WHEN** `config.json` exists after a write
- **THEN** it SHALL NOT be readable by other local users

### Requirement: REST credential storage minimizes XSS exfiltration exposure
The browser REST credential SHALL minimize standing XSS-exfiltration exposure —
preferring an httpOnly, SameSite cookie where the deployment allows, and otherwise
using a shortened, rotatable bearer TTL rather than an indefinite `localStorage`
token. The WebSocket path SHALL continue to use single-use tickets (unchanged).

#### Scenario: cookie-based REST credential when available
- **WHEN** the deployment supports an httpOnly cookie for the REST credential
- **THEN** the durable bearer SHALL NOT be the sole credential exposed in `localStorage`

#### Scenario: bounded bearer when localStorage is unavoidable
- **WHEN** the browser client must hold a REST bearer in `localStorage`
- **THEN** that bearer SHALL have a bounded TTL and be rotatable, not indefinite
