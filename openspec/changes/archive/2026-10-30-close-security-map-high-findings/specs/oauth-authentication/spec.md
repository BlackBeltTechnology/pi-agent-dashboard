## MODIFIED Requirements

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

## ADDED Requirements

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
