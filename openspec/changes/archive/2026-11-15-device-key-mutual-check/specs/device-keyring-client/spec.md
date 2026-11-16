## MODIFIED Requirements

### Requirement: Neutral shell holds a per-device server keyring
A stateless static PWA shell (published to a stable HTTPS origin) SHALL store a
per-device keyring in IndexedDB, each entry being
`{ id, label, urls[], pinnedPubkey, pinnedFingerprint, bearerToken, deviceKey? }` (where `id`
and `pinnedFingerprint` are the pinned server identity checked at connect time),
and SHALL NOT be bound to any
server origin. `deviceKey`, when present, is the per-server device key defined by `device-key-mutual-check`, held as a non-extractable key where the environment supports it.

#### Scenario: Paired server persisted
- **WHEN** a user completes pairing in the neutral shell
- **THEN** a keyring entry with the pinned public key and bearer token is written to IndexedDB

#### Scenario: Server keyring survives shell reload
- **WHEN** the user reloads the shell
- **THEN** previously paired servers remain listed without re-pairing

#### Scenario: Entry carries the device key
- **WHEN** a user pairs in the neutral shell where Ed25519 WebCrypto is available
- **THEN** the keyring entry SHALL also hold the device key for that server
