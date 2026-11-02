## MODIFIED Requirements

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

The cookie SHALL count as proof only for a request that first passes the Origin
gates (`cross-site-request-gate`): a mutating `/api/*` request or a WebSocket
upgrade whose `Origin` is not admitted, such as a page on another loopback port,
SHALL be refused with 403 before proof is evaluated, even when the browser
attaches the cookie.

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
- **WHEN** `requireLocalProof` is `true` and the browser presents a valid local-proof cookie obtained via the launcher code on a same-origin request to a dashboard listener port
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

#### Scenario: cross-port page carrying the cookie is refused
- **WHEN** `requireLocalProof` is `true` and a page on `http://localhost:3000` sends `POST /api/session/spawn` or opens `/ws` with `Origin: http://localhost:3000`, the browser attaching a valid `pi_dash_local` cookie
- **THEN** the request SHALL be refused with 403 before the cookie is evaluated and nothing SHALL be spawned
