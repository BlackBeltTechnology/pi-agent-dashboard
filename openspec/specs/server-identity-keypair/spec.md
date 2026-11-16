# server-identity-keypair Specification

## Purpose
Give each server a persistent Ed25519 identity whose public-key fingerprint is stable across changing URLs, and prove key possession via a nonce challenge so a client can pin the identity and detect an impostor.

## Requirements

### Requirement: Persistent server identity keypair
Each server SHALL ensure a persistent Ed25519 keypair on startup, stored at
`~/.pi/dashboard/identity.key` with `0600` permissions, and SHALL reuse it across
restarts. The public-key fingerprint SHALL serve as the server's stable identity
independent of the URL(s) by which it is reached.

#### Scenario: Keypair generated on first start
- **WHEN** the server starts and no `identity.key` exists
- **THEN** it generates an Ed25519 keypair, writes it with `0600` permissions, and derives a fingerprint

#### Scenario: Keypair reused across restarts
- **WHEN** the server restarts and `identity.key` exists
- **THEN** it loads the existing key and the fingerprint is unchanged

### Requirement: Server proves key possession via nonce challenge
The server SHALL, on request, sign a client-supplied nonce with its private key so
a client can verify the response against a pinned public key. The reply SHALL also carry a `deviceNonce`: 32 random bytes in base64url that the server issues for one later device-status call (`device-key-mutual-check`), single-use, valid for 60 seconds, held in a store bounded to 10 000 entries with the oldest evicted first. The `deviceNonce` is not secret and is not part of the signed identity answer; a client that does not use it SHALL be unaffected, and the challenge SHALL accept no device proof and take no other new input.

#### Scenario: Valid challenge signed
- **WHEN** a client sends a fresh nonce to the identity-challenge endpoint
- **THEN** the server returns a signature over the nonce that verifies against its public key

#### Scenario: Impostor detected
- **WHEN** a client holds a pinned public key and connects to a URL whose server signs the nonce with a different key
- **THEN** signature verification fails and the client SHALL refuse the connection

#### Scenario: Reply carries a fresh device nonce
- **WHEN** a client posts a valid nonce to the identity-challenge endpoint twice
- **THEN** each reply SHALL carry a `deviceNonce` of the expected length, and the two SHALL differ

#### Scenario: Old client ignores the device nonce
- **WHEN** a client that predates the `deviceNonce` field verifies the reply
- **THEN** the fingerprint, public key and signature SHALL verify exactly as before

#### Scenario: Nonce store is bounded
- **WHEN** more than 10 000 challenges are answered inside 60 seconds
- **THEN** the oldest unused `deviceNonce` values SHALL be evicted, and the identity answer of every challenge SHALL be unaffected
