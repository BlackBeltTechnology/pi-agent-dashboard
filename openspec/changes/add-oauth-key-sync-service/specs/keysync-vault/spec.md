## ADDED Requirements

### Requirement: Accounts are encrypted at rest
The service SHALL store every provider account credential as ciphertext under a per-account data key, itself wrapped by a key-encryption key supplied at boot.

#### Scenario: Database contains no plaintext
- **WHEN** the database file is inspected directly
- **THEN** no provider access token or refresh token is readable in plaintext

#### Scenario: Wrong KEK cannot decrypt
- **WHEN** the service starts with a KEK that does not match the one used to write the stored accounts
- **THEN** decryption fails and the service reports the mismatch rather than serving with unusable accounts

### Requirement: Plaintext is confined to process memory
The service SHALL hold decrypted credentials only for the duration of a forward or refresh operation, and SHALL NOT write them to logs or to disk.

#### Scenario: Credential absent from logs
- **WHEN** a request is forwarded upstream and the service logs the outcome at its most verbose level
- **THEN** no access token or refresh token value appears in the log output

#### Scenario: Error paths do not leak
- **WHEN** an upstream call fails and an error is recorded
- **THEN** the recorded error contains no credential material
