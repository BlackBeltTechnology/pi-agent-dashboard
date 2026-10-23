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
The server SHALL support a top-level `requireLocalProof` setting, independent of
whether OAuth providers are configured. When the setting is absent it SHALL
default to `true`. Only an explicit `false` SHALL restore the earlier behaviour,
where a genuinely-local request is trusted without proof; that is the documented
opt-out and rollback path.

When `requireLocalProof` is `true`, a genuinely-local request (loopback, no
forwarding header) SHALL count as genuinely local only if it also carries a
valid local-proof cookie, a valid per-request local credential proof
(`X-Pi-Local-Proof`), or a valid local token. There is one exception: a bare
genuinely-local request SHALL still be admitted to `/api/*` routes whose route
tier is `observe`. The `Host` header SHALL NOT relax this. A loopback peer
claiming `Host: 127.0.0.1:<port>` or `Host: localhost:<port>` without proof is
refused like any other bare loopback request, because a relayed connection from a
local container or VM presents the same peer address and Host it chooses.

This SHALL hold at every genuinely-local decision point through one shared
predicate: the network guard, the auth `onRequest` skip, every WebSocket upgrade
scope (`/ws`, `/ws/terminal/*`, `/live/*`), `/editor/*`, the pairing operator
guard, bridge-ticket minting, and the route-tier exemption. Under strict mode a
trusted-network entry SHALL NOT admit a loopback-range peer that lacks local
proof. Access-posture disclosure keeps its existing predicate. `/v1/*`
model-proxy traffic SHALL keep its existing admission.

The local-proof bootstrap SHALL be available whether or not `requireLocalProof`
is enabled; pairing approval accepts the cookie in every mode. The local-proof
cookie SHALL be obtainable only by redeeming a single-use code, valid for at most
60 seconds, minted by a request carrying a valid local token, and redeemed at
`/auth/local-proof`. The cookie SHALL be httpOnly, `SameSite=Strict`, and signed
with a key derived from the local token. The signature SHALL cover the dashboard
port the cookie was issued for, and a cookie presented on any other port SHALL
be rejected. The cookie SHALL expire 12 hours after its last use (sliding
refresh on an admitted request) and at most 30 days after issue.

The redemption endpoint SHALL accept an optional return target naming where the
browser is sent after the cookie is set. A return target SHALL be constrained by
the SAME rule, and the SAME single implementation, that constrains the post-login
`returnUrl` in "Login OAuth flow is CSRF-protected and returnUrl is constrained"
(`sanitizeReturnUrl`). The rule:
- the value is non-empty;
- it has a single leading `/` not followed by `/` or `\`;
- it has no control character (`U+0000`–`U+001F`, `U+007F`). This rules out TAB,
  CR and LF in particular. URL parsing would otherwise strip them before
  resolution, and they would allow response-header injection on a response that
  sets a credential cookie;
- it is same-origin after resolution against a sentinel origin.

Validation SHALL NOT decode the value a second time. A rejected or absent return
target SHALL redirect to `/`, as before. Honoring a return target SHALL NOT
change code validity, single-use semantics, or the cookie's attributes. There
SHALL NOT be a second return-target predicate in the codebase.

#### Scenario: default denies a bare loopback request
- **WHEN** `requireLocalProof` is unset and a loopback request with no forwarding header, no cookie and no token calls a `control`/`operate` `/api/*` route or opens `/ws`
- **THEN** the request SHALL be denied as in strict mode, with the `local_proof_required` reason on the REST refusal

#### Scenario: spoofed loopback Host from a relayed container is denied
- **WHEN** `requireLocalProof` is unset and a request arrives from peer `127.0.0.1` with `Host: 127.0.0.1:<port>`, no forwarding header and no proof, calling `POST /api/paired-devices`, `POST /api/ws-ticket` with `scope:"bridge"`, or `GET /api/paired-devices`
- **THEN** each request SHALL be refused and no device token or bridge ticket SHALL be minted

#### Scenario: default off preserves loopback access
- **WHEN** `requireLocalProof` is explicitly `false` and a loopback request with no credential calls an `operate`-tier route
- **THEN** the request SHALL be admitted as before

#### Scenario: default keeps local tooling working
- **WHEN** `requireLocalProof` is unset and the desktop shell, the `pi-dashboard` CLI, the bridge extension or the reload script presents its local proof
- **THEN** it SHALL be admitted without any configuration change

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

#### Scenario: proof cookie is bound to its port
- **WHEN** a `pi_dash_local` cookie issued by the dashboard on port 8000 is presented to a dashboard on port 8001
- **THEN** it SHALL NOT count as local proof

#### Scenario: idle proof cookie expires
- **WHEN** a `pi_dash_local` cookie has not been used on an admitted request for 12 hours
- **THEN** it SHALL NOT count as local proof

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
single-use tickets, with one exception: a `live`-scope upgrade MAY instead be
admitted by a live-preview capability path (see the `live-server-preview`
capability), which is short-lived, bound to one preview, never the durable
device credential, and never valid on core sockets (`/ws`, `/ws/terminal/*`,
`/ws/bridge`).

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

#### Scenario: live capability never opens a core socket
- **WHEN** a `/ws` upgrade presents a live-preview capability path or token
- **THEN** it SHALL NOT be admitted by it

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

### Requirement: A refused local browser is told how to authorize itself
When `requireLocalProof` is in effect, `/api/health` SHALL report
`localProof: "required"` only to a caller that is genuinely local (loopback, no
forwarding header), unauthenticated (no session, device bearer or device cookie),
and without valid local proof. It SHALL omit the field for every other caller.
The server SHALL decide this with the same predicate that produces the
`local_proof_required` refusal. The web client SHALL show the network-denied
banner with a copyable `pi-dashboard open` remedy. The field SHALL NOT admit
anything.

#### Scenario: bare local tab sees the remedy
- **WHEN** `requireLocalProof` is in effect and a browser tab opened at `http://localhost:<port>` without a proof cookie loads the dashboard
- **THEN** `/api/health` SHALL report `localProof: "required"` and the client SHALL show the denial banner naming `pi-dashboard open`, not only a generic offline/reconnecting state

#### Scenario: remedy shown when OAuth is configured
- **WHEN** an OAuth provider is configured and a bare local tab without proof or session navigates to the dashboard
- **THEN** the login page SHALL show the `pi-dashboard open` remedy and SHALL NOT auto-redirect to a single provider, and a loaded app in the `auth_required` state SHALL also show it

#### Scenario: proofed tab sees no banner
- **WHEN** the tab presents a valid local-proof cookie, or `requireLocalProof` is explicitly `false`
- **THEN** `/api/health` SHALL omit `localProof` and no local-proof banner SHALL be shown

#### Scenario: field is absent for non-local callers
- **WHEN** a non-loopback caller without a session requests `/api/health`
- **THEN** the body SHALL NOT contain `localProof`

#### Scenario: field is absent for authenticated callers
- **WHEN** a signed-in session or a paired device (bearer or device cookie) without local proof requests `/api/health`, from loopback or from the LAN (a loopback session cookie SHALL be recognised before the strict observe exception returns)
- **THEN** the body SHALL NOT contain `localProof` and no local-proof banner SHALL be shown

### Requirement: Dashboard state is never served to an unproven caller
Every route that reads, writes, searches or probes a filesystem path for a client
(`/api/file*`, `/api/session-file`, `/api/file/write*`, `/api/grep`, file-mention
resolution, open-in-system / reveal, and the live-server static gates) SHALL
decide on the resolved real path. `<dashboard dir>/local/**` and
`<dashboard dir>/identity.key` SHALL be refused for every caller in every mode,
re-checked against the opened handle. Any other dashboard-dir path SHALL be
refused unless the caller is locally trusted or holds a login session.

#### Scenario: local token unreadable from a relayed container
- **WHEN** `requireLocalProof` is unset, any session is running, and a bare loopback request with no proof calls `GET /api/file` for `~/.pi/dashboard/local/token` through that session's `~/.pi` anchor
- **THEN** the server SHALL refuse it and return no file content

#### Scenario: token dir refused even with proof
- **WHEN** a proofed local caller (Electron, CLI) or a signed-in session requests a path inside `~/.pi/dashboard/local/`, or `~/.pi/dashboard/identity.key`
- **THEN** the server SHALL refuse it

#### Scenario: symlink to the state dir is refused
- **WHEN** a session cwd contains a symlink that resolves into `~/.pi/dashboard/local/` and a caller requests it
- **THEN** the server SHALL refuse it, because the decision uses the resolved real path of the opened file

#### Scenario: auth secret unreadable without proof
- **WHEN** `requireLocalProof` is unset and a bare loopback caller without proof, or a paired device, requests `~/.pi/dashboard/config.json`
- **THEN** the server SHALL refuse it

#### Scenario: proofed local editor still opens config.json
- **WHEN** a proofed local caller opens `~/.pi/dashboard/config.json` in the editor pane
- **THEN** the read SHALL be admitted as before

#### Scenario: unproven local caller cannot raise an access prompt
- **WHEN** `requireLocalProof` is unset and a bare loopback request with no proof reads a path outside every containment anchor
- **THEN** the read SHALL be refused without holding the request for an operator access prompt

#### Scenario: grep cannot surface the token
- **WHEN** a bare loopback request with no proof runs `/api/grep` in a session whose cwd contains `.pi/dashboard/local/token`, with or without ripgrep installed
- **THEN** no match or content from that file SHALL be returned

#### Scenario: always-refused file swapped in after the check
- **WHEN** a path is replaced by a symlink to `~/.pi/dashboard/local/token` between the path check and the open
- **THEN** the read SHALL be refused because the opened handle's device and inode match the always-refused file

### Requirement: Secrets exposed before this version are rotated once
On the first start of a server that carries this change, under an exclusive
lock, the server SHALL rotate the local token and `auth.secret` exactly once,
recording a rotation epoch so later starts do not rotate again. Rotation SHALL
happen before the server derives any verifier or proof key from them; if it
cannot complete, the server SHALL NOT start. Every
login session and local-proof cookie issued before the rotation SHALL stop
being valid.

#### Scenario: first start rotates once
- **WHEN** a server carrying this change starts on a HOME whose rotation epoch is below this change's epoch
- **THEN** the local token and `auth.secret` SHALL be replaced, the epoch SHALL be recorded, and a second start SHALL NOT rotate again

#### Scenario: harvested secrets stop working
- **WHEN** a token or `auth.secret` value read before the upgrade is used after the first start
- **THEN** a proof minted from the old token, and a session JWT signed with the old secret, SHALL be rejected

#### Scenario: local tooling follows the new token
- **WHEN** the CLI, the bridge, Electron or the reload script runs after the rotation
- **THEN** it SHALL use the new token without configuration, because each reads the token file per use

#### Scenario: rotation failure fails closed
- **WHEN** the rotation lock cannot be acquired within 35 seconds, or the token or `auth.secret` write fails
- **THEN** the server SHALL exit 1 without listening, log one line naming the failed step and the lock and epoch paths, leave the epoch unwritten, and the next start SHALL retry the whole rotation

#### Scenario: concurrent first starts rotate once
- **WHEN** two servers carrying this change start at the same time on one HOME
- **THEN** exactly one rotation SHALL happen and both SHALL use the rotated values
