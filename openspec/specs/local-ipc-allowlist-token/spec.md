# local-ipc-allowlist-token Specification

## Purpose

Provide an affirmative genuine-local credential — a high-entropy secret presented via the `X-Pi-Local-Token` header — that lets same-host process callers (CLI tools, the model proxy) obtain the auth exemption without relying on the loopback source address alone, which a tunnel can forge. The secret is readable only by the same OS user, so a remote attacker over a tunnel cannot read the file and therefore cannot forge the header.

## Requirements

### Requirement: Local token minting and persistence

The system SHALL maintain a single local-IPC token stored at `~/.pi/dashboard/local/token`, minting it on first need and reusing the persisted value across restarts.

#### Scenario: First mint when no token file exists

- WHEN the local token is ensured and no token file exists
- THEN the system SHALL create the parent directory `~/.pi/dashboard/local` with mode `0700`
- AND generate a high-entropy secret from 32 random bytes encoded as base64url
- AND write it to `~/.pi/dashboard/local/token` with mode `0600`
- AND return the newly minted token

#### Scenario: Reuse of persisted token across restarts

- WHEN the local token is ensured and a non-empty token file already exists
- THEN the system SHALL read and return the existing token from `~/.pi/dashboard/local/token`
- AND SHALL NOT regenerate or overwrite it, so live local callers keep working across a server restart

#### Scenario: Enforce restrictive permissions on a pre-existing directory

- WHEN the local token is ensured and the parent directory already exists with a looser mode
- THEN the system SHALL re-apply mode `0700` to the directory on a best-effort basis so only the same OS user can read the token

### Requirement: Local token header verification

The system SHALL verify a presented `X-Pi-Local-Token` header against the expected token using a constant-time comparison, accepting only an exact match.

#### Scenario: Valid token presented

- WHEN a request carries an `X-Pi-Local-Token` header whose value exactly matches the expected token
- THEN verification SHALL succeed using a constant-time equal-length comparison

#### Scenario: Missing token header

- WHEN a request carries no `X-Pi-Local-Token` header, or an empty value
- THEN verification SHALL fail

#### Scenario: Mismatched token presented

- WHEN a request carries an `X-Pi-Local-Token` header whose value differs from the expected token
- THEN verification SHALL fail
- AND the comparison SHALL not short-circuit on the first differing byte (constant-time)

#### Scenario: Multi-valued header

- WHEN the `X-Pi-Local-Token` header is presented as an array of values
- THEN verification SHALL evaluate only the first value against the expected token

### Requirement: Local token grants the same-host auth exemption

The system SHALL treat a valid `X-Pi-Local-Token` as an affirmative genuine-local credential that bypasses authentication on the request-auth hook, the network guard, and the WebSocket upgrade, independent of the request source address or proxy-forwarding headers.

#### Scenario: Token exempts an authenticated HTTP request

- WHEN an unauthenticated HTTP request presents a valid `X-Pi-Local-Token` header
- THEN the request-auth hook SHALL allow the request without requiring other credentials
- AND this SHALL hold even when a proxy-forwarding header is present that would otherwise disqualify the loopback-only genuine-local check

#### Scenario: Token exempts a network-guarded request

- WHEN a request that is not genuinely local and not from a trusted network presents a valid `X-Pi-Local-Token` header
- THEN the network guard SHALL allow the request and SHALL NOT record a denial block-event

#### Scenario: Token exempts a WebSocket upgrade

- WHEN a WebSocket upgrade request presents a valid `X-Pi-Local-Token` header
- THEN the upgrade SHALL be permitted under the same-host exemption

#### Scenario: Absent or invalid token does not exempt

- WHEN a request presents no valid `X-Pi-Local-Token` and is neither genuinely local nor otherwise authenticated
- THEN the token SHALL NOT grant an exemption, and the request SHALL fall through to the remaining authentication and network-guard checks
