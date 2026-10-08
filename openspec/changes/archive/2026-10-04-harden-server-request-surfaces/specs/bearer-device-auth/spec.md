## MODIFIED Requirements

### Requirement: Long-lived opaque bearer tokens in a revocable registry
A long-lived opaque bearer token SHALL be recorded in a server-side
paired-devices registry (`~/.pi/dashboard/paired-devices.json`, `0600`) with
device label, created-at, last-seen, an issuance `source`, and a `tier` from
`observe | control | operate`. Tokens SHALL be issued by one of two paths:
redeeming a pairing code (`source: "pairing"`) or direct issuance by an
authenticated operator (`source: "manual"`). Both paths SHALL accept a tier;
when omitted, `pairing` SHALL default to `operate` (a paired browser drives
the whole dashboard) and `manual` SHALL default to `observe`. Both paths
SHALL return the
plaintext token exactly once and store only a hash. The token SHALL be
revocable per device by deleting its registry entry regardless of source or
tier. The tier SHALL be fixed at issuance; changing a device's tier SHALL
require revoking it and issuing a new token. Registry rows written before
`source` existed SHALL read as `"pairing"`; rows written before `tier` existed
SHALL read as `"operate"` (the access they were issued with). Rewriting the
registry SHALL preserve fields it does not understand.

Revocation SHALL accept only an **operator** credential — the same admission
rule as direct token issuance: an authenticated dashboard login session, a
valid `X-Pi-Local-Token`, or a genuinely local (loopback, non-forwarded)
caller. A request authenticated only by a paired-device bearer SHALL NOT
revoke any registry row, including its own, regardless of the caller's network
position — a device bearer arriving over loopback SHALL be refused on the
strength of the credential alone.

#### Scenario: Token issued and recorded
- **WHEN** a device successfully redeems a pairing code
- **THEN** an opaque bearer token is returned and a registry entry with `source: "pairing"` and the chosen tier is created for the device

#### Scenario: Manual issuance defaults to observe
- **WHEN** a token is issued through direct issuance without an explicit tier
- **THEN** the registry entry SHALL carry `tier: "observe"`

#### Scenario: Pairing issuance defaults to operate
- **WHEN** a pairing code is redeemed without an explicit tier from the approver
- **THEN** the registry entry SHALL carry `tier: "operate"`

#### Scenario: Invalid tier rejected
- **WHEN** a token is requested with a tier outside `observe | control | operate`
- **THEN** the request SHALL be rejected and no registry entry SHALL be created

#### Scenario: Device revoked
- **WHEN** a user revokes a device from Settings
- **THEN** its registry entry is deleted and subsequent requests bearing that token are rejected

#### Scenario: Legacy row without source
- **WHEN** the registry file contains a row that has no `source` field
- **THEN** the row SHALL be listed with `source: "pairing"`
- **AND** its token SHALL continue to verify

#### Scenario: Legacy row without tier
- **WHEN** the registry file contains a row that has no `tier` field
- **THEN** the row SHALL be listed with `tier: "operate"`
- **AND** its token SHALL continue to verify

#### Scenario: Unknown fields survive a rewrite
- **WHEN** the registry file contains a row with a field the loader does not know
- **AND** another row is added or revoked
- **THEN** the unknown field SHALL still be present in the rewritten file

#### Scenario: Tier visible in the device list
- **WHEN** paired devices are listed
- **THEN** each row SHALL include its `tier`

#### Scenario: Paired device cannot revoke a sibling
- **GIVEN** two paired devices A and B exist in the registry
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>`
- **THEN** the server SHALL respond `401`
- **AND** device B's registry row SHALL remain and its token SHALL continue to verify

#### Scenario: Paired device cannot revoke itself
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of A>`
- **THEN** the server SHALL respond `401` and device A's row SHALL remain

#### Scenario: Loopback device bearer cannot revoke
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>` from `127.0.0.1` with no forwarding headers
- **THEN** the server SHALL respond `401` and device B's row SHALL remain

#### Scenario: Operator revokes over a tunnel
- **WHEN** a request carrying an authenticated dashboard login session sends `DELETE /api/paired-devices/<id>` from a non-local address
- **THEN** the server SHALL revoke the row and respond `200`
