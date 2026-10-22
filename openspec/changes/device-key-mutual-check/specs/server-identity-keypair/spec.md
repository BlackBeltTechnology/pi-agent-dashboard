## MODIFIED Requirements

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
