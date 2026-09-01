## ADDED Requirements

### Requirement: The archive SHALL separate a small index from a blob store

Manifests, encrypted session metadata, provenance records, goals, and claims
SHALL be stored in a git index repository. Segment blobs and other large objects
SHALL be stored in an S3-compatible blob store and referenced from the index by
an **opaque object key** recorded alongside the segment identity. The object key
SHALL NOT be derived from the content.

#### Scenario: Listing sessions requires no blob-store access

- **WHEN** a client lists the sessions available in an archive
- **THEN** the listing is produced from the decrypted index repository alone
- **AND** no blob-store request is issued
- **AND** no transcript is written to the local session store

#### Scenario: Bytes are fetched only when a session is opened

- **WHEN** a user opens or resumes a remote session
- **THEN** only that session's segment blobs are fetched

#### Scenario: The index repository holds no large objects

- **WHEN** an archive containing sessions totalling hundreds of megabytes is
  published
- **THEN** the index repository contains no segment payloads

#### Scenario: Index history does not grow without bound

- **WHEN** many seal-and-publish cycles have accumulated
- **THEN** the content namespace history is compacted so its size stays bounded
- **AND** the current index content is preserved

#### Scenario: Compaction never rewrites the claims namespace

- **WHEN** the index content namespace is compacted
- **THEN** the claims namespace is not rewritten
- **AND** an in-flight claim renewal is unaffected

### Requirement: Every published object SHALL be encrypted client-side

All published objects — segments, manifests, session metadata, provenance
records, goals, and claims — SHALL be encrypted before leaving the machine,
using multi-recipient encryption keyed to per-machine **X25519 archive**
keypairs generated for this purpose. The existing Ed25519 pairing identity
SHALL NOT be reused as an archive encryption key. Encryption SHALL be
non-deterministic.

#### Scenario: Index objects are encrypted, not only blobs

- **WHEN** the index repository is read without a recipient private key
- **THEN** no manifest, metadata, provenance record, goal, or claim content is
  recoverable

#### Scenario: Claims do not disclose machine names

- **WHEN** a claim is published
- **THEN** it identifies the holder by an opaque machine identifier
- **AND** no hostname or account name appears in the index in clear text

#### Scenario: The pairing identity is not the archive key

- **WHEN** archive encryption is configured
- **THEN** the archive keypair is distinct from the Ed25519 pairing identity

#### Scenario: Stored objects are unreadable without a recipient key

- **WHEN** a blob or index object is read without a configured recipient private
  key
- **THEN** no transcript content, session title, or path is recoverable

#### Scenario: Session titles are not published in clear text

- **GIVEN** session metadata containing a `firstMessage` field
- **WHEN** the archive is published
- **THEN** the `firstMessage` value does not appear in clear text in the index
  repository or the blob store

#### Scenario: Identical plaintext produces different ciphertext

- **WHEN** the same segment content is encrypted twice
- **THEN** the two ciphertexts differ

#### Scenario: A removed recipient cannot read subsequent segments

- **WHEN** a recipient is removed and new segments are published
- **THEN** those segments cannot be decrypted with the removed recipient's key

### Requirement: Machine-local secrets SHALL never be published

The archive SHALL NOT include `identity.key`, `paired-devices.json`,
`headless-pids.json`, `editor-pids.json`, blob-store credentials, or the global
`preferences.json`.

#### Scenario: Excluded files are absent from a published archive

- **WHEN** an archive is published
- **THEN** none of the excluded files appear in the index repository or the blob
  store

### Requirement: The blob store SHALL be configured per project by the operator

The blob store SHALL be addressed through the generic S3 API with an
operator-supplied endpoint, bucket, and credentials. No specific provider SHALL
be required.

#### Scenario: An arbitrary S3-compatible endpoint is accepted

- **WHEN** an operator configures a custom endpoint, bucket, and credentials
- **THEN** publish and fetch succeed against that endpoint

#### Scenario: Missing configuration refuses export

- **WHEN** export is attempted with no blob-store configuration
- **THEN** it fails with an explicit configuration error and publishes nothing
