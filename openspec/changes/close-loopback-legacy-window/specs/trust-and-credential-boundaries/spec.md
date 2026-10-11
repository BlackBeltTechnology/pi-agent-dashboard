## MODIFIED Requirements

### Requirement: Opt-in local proof for loopback trust
The server SHALL support a top-level `requireLocalProof` setting, defaulting to
`false`, independent of whether OAuth providers are configured. When `false`,
loopback admission SHALL be unchanged. When `true`, a genuinely-local request
(loopback, no forwarding header) SHALL count as genuinely local only if it also
carries a valid local-proof cookie or a valid local credential proof (see
`local-ipc-allowlist-token`) — with one exception:
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
local credential proof and redeemed at `/auth/local-proof`; the cookie SHALL be httpOnly, `SameSite=Strict`, and signed with a
key derived from the local token, so rotating the local token invalidates every
issued local-proof cookie.

#### Scenario: default off preserves loopback access
- **WHEN** `requireLocalProof` is unset and a loopback request with no credential calls an `operate`-tier route
- **THEN** the request SHALL be admitted as before

#### Scenario: marker-less loopback relay denied under strict mode
- **WHEN** `requireLocalProof` is `true` and a loopback request with no forwarding header, no cookie, and no local credential proof calls a `control`/`operate` `/api/*` route, opens `/ws`, `/ws/terminal/<id>` or `/live/*`, or calls a pairing operator route
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
- **WHEN** `requireLocalProof` is `true` and a loopback request presents a valid `X-Pi-Local-Proof`
- **THEN** it SHALL be admitted as before

#### Scenario: raw local token does not satisfy strict mode
- **WHEN** `requireLocalProof` is `true` and a loopback request with no cookie presents only a raw `X-Pi-Local-Token` on a `control`/`operate` route
- **THEN** the request SHALL be denied

#### Scenario: rotated token invalidates issued cookies
- **WHEN** the local token is rotated and a browser presents a local-proof cookie issued before the rotation
- **THEN** the cookie SHALL NOT be accepted as local proof
- **AND** a fresh launcher bootstrap SHALL obtain a valid cookie

#### Scenario: strict mode works without OAuth providers
- **WHEN** `requireLocalProof` is `true` and no OAuth provider is configured
- **THEN** the launcher SHALL still mint a code and the browser SHALL still obtain a local-proof cookie

#### Scenario: local-proof code is single-use and token-gated
- **WHEN** a code is minted without a valid local credential proof, or a code is redeemed a second time or after 60 seconds
- **THEN** no code SHALL be minted, and no local-proof cookie SHALL be set
