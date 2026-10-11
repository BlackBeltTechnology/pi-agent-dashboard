## MODIFIED Requirements

### Requirement: Local token header verification

The system SHALL recognise a local credential presented either as a local
credential proof in the `X-Pi-Local-Proof` header, verified per the
endpoint-bound proof rules of `pi-gateway-auth`, or — only while the legacy
window is open — as the raw `X-Pi-Local-Token` header compared against the
expected token in constant time. A request carries a valid local token if and
only if one of these verifies. For HTTP requests the proof's purpose SHALL bind
the request method and request target. Verification SHALL run once per request,
at the listener that received it, and its verdict SHALL be consulted by every
check that previously compared the raw header — including the identity
break-glass, the local-code and local-proof bootstrap routes, and the passkey
genuine-local check. A check consulted for a request that was never verified
SHALL treat it as carrying no local credential.

#### Scenario: Valid token presented

- **WHEN** the legacy window is open and a request carries an `X-Pi-Local-Token` header whose value exactly matches the expected token
- **THEN** verification SHALL succeed using a constant-time equal-length comparison
- **AND** the server SHALL log the use as deprecated

#### Scenario: Valid proof presented

- **WHEN** a request carries an `X-Pi-Local-Proof` header bound to the request's arrival address and port, its method and its request target, fresh, correctly MACed and not replayed
- **THEN** verification SHALL succeed

#### Scenario: Proof for another request target

- **WHEN** a proof bound to one method or request target is presented on a different one
- **THEN** verification SHALL fail

#### Scenario: Missing token header

- **WHEN** a request carries neither an `X-Pi-Local-Proof` header nor an `X-Pi-Local-Token` header, or only empty values
- **THEN** verification SHALL fail

#### Scenario: Mismatched token presented

- **WHEN** a request carries an `X-Pi-Local-Token` header whose value differs from the expected token
- **THEN** verification SHALL fail
- **AND** the comparison SHALL not short-circuit on the first differing byte (constant-time)

#### Scenario: Multi-valued header

- **WHEN** the `X-Pi-Local-Token` or `X-Pi-Local-Proof` header is presented as an array of values
- **THEN** verification SHALL evaluate only the first value

#### Scenario: Shipped local tooling is admitted by proof everywhere

- **WHEN** the CLI runs `login --local`, `open`, or `token create` against a dashboard of the same version
- **THEN** each route SHALL admit it on the proof alone

#### Scenario: Rejection does not reveal the sub-cause

- **WHEN** an HTTP request's proof fails verification and the request is refused
- **THEN** the response body SHALL be identical to the response for a request with no local credential

### Requirement: Local token grants the same-host auth exemption

The system SHALL treat a valid local token (as defined by local token header
verification) as an affirmative genuine-local credential that bypasses
authentication on the request-auth hook, the network guard, the pairing
operator/approval guards, the strict local-proof checks, and the WebSocket
upgrade, independent of the request source address or proxy-forwarding
headers. Local tooling shipped with this system (CLI, Electron main process,
reload script) SHALL present a proof, dialled at a loopback address literal,
and SHALL NOT transmit the raw token.

#### Scenario: Token exempts an authenticated HTTP request

- **WHEN** an unauthenticated HTTP request presents a valid local token
- **THEN** the request-auth hook SHALL allow the request without requiring other credentials
- **AND** this SHALL hold even when a proxy-forwarding header is present that would otherwise disqualify the loopback-only genuine-local check

#### Scenario: Token exempts a network-guarded request

- **WHEN** a request that is not genuinely local and not from a trusted network presents a valid local token
- **THEN** the network guard SHALL allow the request and SHALL NOT record a denial block-event

#### Scenario: Token exempts a WebSocket upgrade

- **WHEN** a WebSocket upgrade request presents a valid local token
- **THEN** the upgrade SHALL be permitted under the same-host exemption

#### Scenario: Absent or invalid token does not exempt

- **WHEN** a request presents no valid local token and is neither genuinely local nor otherwise authenticated
- **THEN** the token SHALL NOT grant an exemption, and the request SHALL fall through to the remaining authentication and network-guard checks

#### Scenario: Shipped local tooling never sends the raw token

- **WHEN** the CLI, the Electron main process or the reload script calls the dashboard's HTTP API with the local credential
- **THEN** the request SHALL carry `X-Pi-Local-Proof`
- **AND** it SHALL NOT carry `X-Pi-Local-Token`
