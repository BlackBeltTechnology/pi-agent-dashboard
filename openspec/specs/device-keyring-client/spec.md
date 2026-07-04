# device-keyring-client Specification

## Purpose
Hold a per-device keyring of paired servers in a neutral, origin-independent client, pinning each server's public key and racing its endpoints so a network change needs no re-pairing.

## Requirements
### Requirement: Neutral shell holds a per-device server keyring
A stateless static PWA shell (published to a stable HTTPS origin) SHALL store a
per-device keyring in IndexedDB, each entry being
`{ id, label, urls[], pinnedPubkey, pinnedFingerprint, bearerToken }` (where `id`
and `pinnedFingerprint` are the pinned server identity checked at connect time),
and SHALL NOT be bound to any
server origin.

#### Scenario: Paired server persisted
- **WHEN** a user completes pairing in the neutral shell
- **THEN** a keyring entry with the pinned public key and bearer token is written to IndexedDB

#### Scenario: Server keyring survives shell reload
- **WHEN** the user reloads the shell
- **THEN** previously paired servers remain listed without re-pairing

### Requirement: Client pins identity and races endpoints
On connect the client SHALL verify the server's nonce signature against the pinned
public key, and when an entry has multiple `urls[]` it SHALL try them per network
and use whichever responds and proves the pinned key.

#### Scenario: Network change without re-pairing
- **WHEN** the device moves from Wi-Fi to cellular and the LAN URL is unreachable
- **THEN** the client falls back to the tunnel URL under the same pinned identity, no re-pairing

#### Scenario: Pin mismatch refused
- **WHEN** a reachable URL's server fails the pinned-key verification
- **THEN** the client refuses that endpoint and surfaces an identity-mismatch warning

### Requirement: Copy-string pairing without a camera
The shell SHALL accept a pasted copy-string payload as an alternative to scanning
a QR code, producing an equivalent keyring entry.

#### Scenario: Paste to pair
- **WHEN** a user pastes a valid copy-string into the shell's pairing input
- **THEN** the shell parses the payload and pairs exactly as if the QR had been scanned

