# trust-and-credential-boundaries Specification

## Purpose
TBD - created by archiving change harden-trust-and-credential-boundaries. Update Purpose after archive.

## Requirements

### Requirement: Login OAuth flow is CSRF-protected and returnUrl is constrained
The dashboard login OAuth flow SHALL bind its state nonce to a short-lived,
HMAC-signed, httpOnly, `SameSite=Lax` cookie set when login starts, and SHALL
verify on callback — before exchanging the authorization code — that the state
nonce matches the cookie. A missing or mismatched state SHALL reject the login
with no session issued and no code exchange. The post-login `returnUrl` SHALL be
constrained to same-origin absolute paths by one shared predicate
(`sanitizeReturnUrl`), which is also the predicate for the local-proof
redemption return target (see "Opt-in local proof for loopback trust"). A value
SHALL be accepted only when ALL of the following hold, and SHALL otherwise be
replaced by `/`: it is a non-empty string; it begins with a single `/` that is
not followed by `/` or `\`; it contains no control character (`U+0000`–`U+001F`,
`U+007F`) — in particular no TAB, CR or LF; and, resolved against a fixed
sentinel origin, it still has that sentinel origin (no scheme, no authority).
The value SHALL NOT be decoded a second time before validation.

#### Scenario: mismatched state rejected
- **WHEN** an OAuth callback arrives whose state nonce does not match the state cookie
- **THEN** the login SHALL be rejected, no session cookie SHALL be set, and the authorization code SHALL NOT be exchanged

#### Scenario: missing state cookie rejected
- **WHEN** an OAuth callback arrives with a state parameter but no state cookie
- **THEN** the login SHALL be rejected with no session issued

#### Scenario: cross-origin returnUrl neutralized
- **WHEN** login is initiated with `return=https://evil.example/steal`, `return=//evil.example`, `return=/\evil.example`, or a double-encoded `return=%252F%252Fevil.example`
- **THEN** the post-login redirect SHALL go to `/`, not the cross-origin URL

#### Scenario: control-character returnUrl neutralized
- **WHEN** login is initiated with a `returnUrl` containing a TAB, CR, LF or other control character — for example `/<TAB>/evil.example` or `/<CR><LF>Set-Cookie: x=y`
- **THEN** the post-login redirect SHALL go to `/`
- **AND** no `Location` value containing a control character SHALL be emitted

#### Scenario: normal login succeeds
- **WHEN** a valid OAuth callback matches the state cookie and `returnUrl` is a same-origin path
- **THEN** the session SHALL be issued, the state cookie cleared, and the user redirected to that path

### Requirement: Opt-in local proof for loopback trust
The server SHALL support a top-level `requireLocalProof` setting, defaulting to
`false`, independent of whether OAuth providers are configured. When `false`,
loopback admission SHALL be unchanged. When `true`, a genuinely-local request
(loopback, no forwarding header) SHALL count as genuinely local only if it also
carries a valid local-proof cookie or a valid local token — with one exception:
a bare genuinely-local request SHALL still be admitted to `/api/*` routes whose
route tier is `observe`. This SHALL hold at every genuinely-local decision point
through one shared predicate: the network guard, the auth `onRequest` skip, every
WebSocket upgrade scope (`/ws`, `/ws/terminal/*`, `/live/*`), `/editor/*`, the
pairing operator guard, bridge-ticket minting, and the route-tier exemption.
Under strict mode a trusted-network entry SHALL NOT admit a loopback-range peer
that lacks local proof. Access-posture disclosure keeps its existing predicate. `/v1/*` model-proxy traffic SHALL keep its existing
admission. The local-proof bootstrap SHALL be available whether or not
`requireLocalProof` is enabled (pairing approval accepts the cookie in every
mode). The local-proof cookie SHALL be obtainable only by redeeming a
single-use code, valid at most 60 seconds, minted by a request carrying a valid
local token and redeemed at `/auth/local-proof`; the cookie SHALL be httpOnly, `SameSite=Strict`, and signed with a
key derived from the local token.

The redemption endpoint SHALL accept an optional return target naming where the
browser is sent after the cookie is set. A return target SHALL be constrained by
the SAME rule, and the SAME single implementation, that constrains the post-login
`returnUrl` as stated in "Login OAuth flow is CSRF-protected and returnUrl is
constrained" (`sanitizeReturnUrl`): non-empty; a single leading `/` not followed
by `/` or `\`; no control character (`U+0000`–`U+001F`, `U+007F`) — in particular
no TAB, CR or LF, which URL parsing would otherwise strip before resolution and
which would also permit response-header injection on a response that sets a
credential cookie; and same origin after resolution against a sentinel origin.
Validation SHALL NOT decode the value a second time. A rejected or absent return target SHALL redirect to
`/`, as before. Honoring a return target SHALL NOT change code validity,
single-use semantics, or the cookie's attributes. There SHALL NOT be a second
return-target predicate in the codebase.

#### Scenario: default off preserves loopback access
- **WHEN** `requireLocalProof` is unset and a loopback request with no credential calls an `operate`-tier route
- **THEN** the request SHALL be admitted as before

#### Scenario: marker-less loopback relay denied under strict mode
- **WHEN** `requireLocalProof` is `true` and a loopback request with no forwarding header, no cookie, and no token calls a `control`/`operate` `/api/*` route, opens `/ws`, `/ws/terminal/<id>` or `/live/*`, or calls a pairing operator route
- **THEN** the request SHALL be denied

#### Scenario: observe-tier route still allowed under strict mode
- **WHEN** `requireLocalProof` is `true` and a bare loopback request calls an `observe`-tier `/api/*` route
- **THEN** the request SHALL be admitted

#### Scenario: local-proof cookie admits the desktop browser
- **WHEN** `requireLocalProof` is `true` and the browser presents a valid local-proof cookie obtained via the launcher code
- **THEN** `control`/`operate` routes and every WebSocket scope SHALL be admitted

#### Scenario: loopback trusted entry does not admit a relay under strict mode
- **WHEN** `requireLocalProof` is `true`, `trustedNetworks` contains `127.0.0.1`, and a bare loopback request with no proof calls an `operate` route
- **THEN** the request SHALL be denied

#### Scenario: local token still admits local tooling
- **WHEN** `requireLocalProof` is `true` and a loopback request presents a valid `X-Pi-Local-Token`
- **THEN** it SHALL be admitted as before

#### Scenario: strict mode works without OAuth providers
- **WHEN** `requireLocalProof` is `true` and no OAuth provider is configured
- **THEN** the launcher SHALL still mint a code and the browser SHALL still obtain a local-proof cookie

#### Scenario: local-proof code is single-use and token-gated
- **WHEN** a code is minted without a valid local token, or a code is redeemed a second time or after 60 seconds
- **THEN** no code SHALL be minted, and no local-proof cookie SHALL be set

#### Scenario: same-origin return target is honored
- **WHEN** a valid code is redeemed with the return target `/settings/gateway`
- **THEN** the proof cookie SHALL be set and the browser SHALL be sent to `/settings/gateway`

#### Scenario: off-origin return target is refused
- **WHEN** a valid code is redeemed with a return target of `https://evil.example/`, `//evil.example/`, `/\evil.example/`, a double-encoded `%252F%252Fevil.example`, or a value not beginning with `/`
- **THEN** the proof cookie SHALL be set and the browser SHALL be sent to `/`
- **AND** no redirect to any other origin SHALL be issued

#### Scenario: whitespace-smuggled authority is refused
- **WHEN** a valid code is redeemed with a return target containing a TAB, CR or LF before the authority — for example `/<TAB>/evil.example` or `/<CR><LF>/evil.example`
- **THEN** the proof cookie SHALL be set and the browser SHALL be sent to `/`
- **AND** no `Location` value containing a line break SHALL be emitted

#### Scenario: one return-target rule for both redemption and login
- **WHEN** the same return-target value is given to `/auth/local-proof` and to the post-login redirect
- **THEN** both SHALL accept it or both SHALL reject it, because both apply the same predicate

#### Scenario: return target does not revive a spent code
- **WHEN** a code that has already been redeemed is presented again with any return target
- **THEN** no cookie SHALL be set and no return redirect SHALL be issued

### Requirement: Secret-bearing config file is written 0600
Every write of `config.json` SHALL produce a file with mode `0600`, independent
of the process umask, across all write paths. On load, an existing
`config.json` readable by group or others SHALL be tightened to `0600`.

#### Scenario: config file mode on write
- **WHEN** the server writes or updates `config.json` through any write path
- **THEN** the resulting file mode SHALL be `0600`

#### Scenario: legacy world-readable file tightened
- **WHEN** the server loads a `config.json` with mode `0644`
- **THEN** the file mode SHALL become `0600`

### Requirement: Browser device credential is not JS-readable
A browser whose API base is same-origin and that pairs SHALL exchange its paired-device bearer for an
httpOnly, `SameSite=Strict` cookie scoped to `path=/api/` that the server
accepts, on `/api/*` only, as a device credential with the same tier and
revocation as the bearer, and SHALL NOT keep the bearer in `localStorage`. The
exchange route SHALL be callable by a device of any tier. The cookie SHALL NOT
be sent on WebSocket upgrades. A client whose API base is cross-origin SHALL
keep the existing `Authorization: Bearer` behaviour unchanged. A bearer already stored in `localStorage` SHALL be
exchanged and removed on next load. WebSocket access SHALL continue to use
single-use tickets.

#### Scenario: pairing stores no bearer in localStorage
- **WHEN** a browser completes pairing
- **THEN** `localStorage` SHALL hold no bearer value and subsequent `/api/*` requests SHALL authenticate via the cookie

#### Scenario: legacy stored bearer migrated
- **WHEN** the client loads with a bearer under the legacy `localStorage` key
- **THEN** it SHALL be exchanged for the cookie and removed from `localStorage`

#### Scenario: revoked device cookie refused
- **WHEN** a paired device is revoked and its browser presents the device cookie
- **THEN** the request SHALL NOT be authenticated

#### Scenario: observe-tier device can exchange
- **WHEN** a paired device with tier `observe` posts its bearer to the exchange route
- **THEN** the cookie SHALL be set and requests SHALL keep tier `observe`

#### Scenario: cross-origin API base keeps the bearer
- **WHEN** the client's API base is on a different origin than the page
- **THEN** no exchange SHALL occur and REST + WS-ticket minting SHALL keep using `Authorization: Bearer`

#### Scenario: WS ticket minted via cookie
- **WHEN** a cookie-paired browser opens the WebSocket
- **THEN** it SHALL mint a single-use ticket using the cookie, and the durable credential SHALL NOT ride the socket

### Requirement: Request-access remedy is the one recorded exception to the access-posture disclosure predicate

Notwithstanding the sentence "Access-posture disclosure keeps its existing
predicate" in "Opt-in local proof for loopback trust", the access-posture
disclosure predicate (the caller is authenticated or genuinely local) SHALL keep
governing every disclosure of access posture, unchanged, with exactly one
recorded exception: the `request-access` remedy of an `operate_required` refusal
(`operate-required-remedy`) SHALL be disclosed to a caller that is neither
authenticated nor genuinely local when that remedy's presence rule holds. The
exception SHALL be limited to facts the same caller can already obtain from the
public knock route by a same-origin request with the same peer, forwarding
headers and `Host` — whether the knock's admission gates
before its operator switch (Host admission, network position) would pass. It
SHALL NOT disclose `pairing.acceptLanRequests`, pending knocks, knock limits or
cooldowns, the host-gate mode, trusted-network entries, interface addresses or
subnets, or any other posture. Any further exception SHALL be recorded by
modifying this requirement.

#### Scenario: Exception carries only the knock-gate verdict

- **GIVEN** a caller with no credential, not genuinely local, admitted by the network guard, whose socket peer is on-link and private, with an admitted `Host`
- **WHEN** it is refused with `operate_required`
- **THEN** the body SHALL contain the `request-access` remedy
- **AND** the body SHALL contain no address, subnet, interface, trusted-network entry, LAN-request switch state or knock state

#### Scenario: Other posture surfaces keep the predicate

- **GIVEN** the caller of "Exception carries only the knock-gate verdict"
- **WHEN** it calls `GET /api/health`
- **THEN** the response SHALL carry no access-grant or trust-posture data (`accessGrants` and `trustPosture` stay withheld), exactly as before this change
