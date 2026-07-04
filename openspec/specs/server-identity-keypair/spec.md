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
a client can verify the response against a pinned public key.

#### Scenario: Valid challenge signed
- **WHEN** a client sends a fresh nonce to the identity-challenge endpoint
- **THEN** the server returns a signature over the nonce that verifies against its public key

#### Scenario: Impostor detected
- **WHEN** a client holds a pinned public key and connects to a URL whose server signs the nonce with a different key
- **THEN** signature verification fails and the client SHALL refuse the connection

