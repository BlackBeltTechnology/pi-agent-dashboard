## MODIFIED Requirements

### Requirement: Local token header verification

The system SHALL recognise a local credential only as a local credential proof
in the `X-Pi-Local-Proof` header, verified per the endpoint-bound proof rules of
`pi-gateway-auth`. A request carries a valid local token if and only if that
proof verifies; the raw `X-Pi-Local-Token` header SHALL NOT verify, whatever its
value. For HTTP requests the proof's purpose SHALL bind the request method and
request target. Verification SHALL run once per request, at the listener that
received it, and its verdict SHALL be consulted by every check that requires a
local credential — including the identity break-glass, the local-code and
local-proof bootstrap routes, and the passkey genuine-local check. A check
consulted for a request that was never verified SHALL treat it as carrying no
local credential.

#### Scenario: Valid token presented

- **WHEN** a request carries an `X-Pi-Local-Token` header whose value exactly matches the expected token, and no `X-Pi-Local-Proof` header
- **THEN** verification SHALL fail
- **AND** the presented value SHALL NOT be compared against the expected token

#### Scenario: Valid proof presented

- **WHEN** a request carries an `X-Pi-Local-Proof` header bound to the request's arrival address and port, its method and its request target, fresh, correctly MACed and not replayed
- **THEN** verification SHALL succeed

#### Scenario: Proof for another request target

- **WHEN** a proof bound to one method or request target is presented on a different one
- **THEN** verification SHALL fail

#### Scenario: Missing token header

- **WHEN** a request carries no `X-Pi-Local-Proof` header, or only an empty value
- **THEN** verification SHALL fail

#### Scenario: Mismatched token presented

- **WHEN** a request carries an `X-Pi-Local-Token` header whose value differs from the expected token, and no `X-Pi-Local-Proof` header
- **THEN** verification SHALL fail exactly as for a matching raw value
- **AND** no comparison SHALL distinguish the two cases

#### Scenario: Multi-valued header

- **WHEN** the `X-Pi-Local-Proof` header is presented as an array of values
- **THEN** verification SHALL evaluate only the first value

#### Scenario: Shipped local tooling is admitted by proof everywhere

- **WHEN** the CLI runs `login --local`, `open`, or `token create` against a dashboard of the same version
- **THEN** each route SHALL admit it on the proof alone

#### Scenario: Rejection does not reveal the sub-cause

- **WHEN** an HTTP request's proof fails verification and the request is refused
- **THEN** the response body SHALL be identical to the response for a request with no local credential

### Requirement: Local token minting and persistence

The system SHALL maintain a single local-IPC token stored at
`~/.pi/dashboard/local/token`, minting it on first need and reusing the
persisted value across restarts. The persisted token SHALL carry a rotation
epoch recorded beside it. When the server starts and finds a token whose epoch
is older than the epoch this version requires — including a token with no
recorded epoch — it SHALL replace the token with a newly minted one before any
credential is verified or derived from it, then record the required epoch. The
rotation SHALL happen once per required-epoch increase, not on every restart.

#### Scenario: First mint when no token file exists

- **WHEN** the local token is ensured and no token file exists
- **THEN** the system SHALL create the parent directory `~/.pi/dashboard/local` with mode `0700`
- **AND** generate a high-entropy secret from 32 random bytes encoded as base64url
- **AND** write it to `~/.pi/dashboard/local/token` with mode `0600`
- **AND** record the required rotation epoch
- **AND** return the newly minted token

#### Scenario: Reuse of persisted token across restarts

- **WHEN** the local token is ensured and a non-empty token file already exists with the required rotation epoch recorded
- **THEN** the system SHALL read and return the existing token from `~/.pi/dashboard/local/token`
- **AND** SHALL NOT regenerate or overwrite it, so live local callers keep working across a server restart

#### Scenario: Pre-rotation token is replaced once

- **WHEN** the server starts and the token file exists but no rotation epoch, or an older one, is recorded
- **THEN** the system SHALL replace the token with a new 32-byte secret that differs from the old value
- **AND** the replacement SHALL be written so a reader never observes a partial or empty token file, with mode `0600`
- **AND** the system SHALL record the required rotation epoch only after the new token is persisted
- **AND** a following restart SHALL reuse the new token

#### Scenario: Interrupted rotation completes on next start

- **WHEN** the server stopped after persisting the new token but before recording the epoch
- **THEN** the next start SHALL rotate again and record the epoch

#### Scenario: Current clients follow the rotated token

- **WHEN** the token has been rotated and a bridge, the CLI or the Electron app of this version next dials or sends a request
- **THEN** it SHALL read the rotated token from the file and be admitted on a proof derived from it

#### Scenario: Enforce restrictive permissions on a pre-existing directory

- **WHEN** the local token is ensured and the parent directory already exists with a looser mode
- **THEN** the system SHALL re-apply mode `0700` to the directory on a best-effort basis so only the same OS user can read the token
