## ADDED Requirements

### Requirement: The canonical form SHALL be the scrubbed transcript

Sealing, digesting, and publishing SHALL operate on the canonical (scrubbed)
form of a transcript. The expanded on-disk transcript SHALL be treated as a
rendering of the canonical form and SHALL NOT be used as a segment source.
Scrubbing and expansion SHALL round-trip exactly: `scrub(expand(x))` SHALL equal
`x`.

#### Scenario: An imported session re-seals against the canonical form

- **GIVEN** a session imported and materialised with local absolute paths
- **WHEN** it is resumed and its transcript grows and seals a new segment
- **THEN** the sealed segment is derived from the canonical form
- **AND** the identities of its already-published segments are unchanged

#### Scenario: A literal placeholder token in content round-trips unchanged

- **GIVEN** a transcript whose prose contains the literal text `{{CWD}}`
- **WHEN** the transcript is scrubbed and then expanded
- **THEN** the prose still contains the literal text `{{CWD}}`
- **AND** it was not replaced by any local path

### Requirement: Transcripts SHALL be published as sealed immutable segments

A session transcript SHALL be published as an ordered list of segments over its
canonical form. A segment SHALL be sealed when any of the configured `bytes`,
`lines`, or `idle-seconds` thresholds is reached. Once sealed and published, a
segment SHALL NOT be rewritten, re-uploaded, or replaced. The unsealed tail
SHALL remain local.

#### Scenario: A growing session seals successive segments

- **WHEN** a live session's transcript grows past the configured seal threshold
  three times
- **THEN** three sealed segments exist, each covering a disjoint, contiguous
  range of transcript lines
- **AND** each sealed segment's content digest is stable across repeated
  publishes

#### Scenario: Appending to a session never rewrites an existing segment

- **WHEN** new entries are appended after `seg-0002` was sealed
- **THEN** `seg-0002`'s digest is unchanged
- **AND** the new entries appear only in `seg-0003` or the unsealed tail

#### Scenario: A segment boundary never splits a JSONL line

- **WHEN** a seal threshold falls in the middle of a transcript line
- **THEN** the segment ends at the preceding line boundary
- **AND** concatenating all segments reproduces a valid JSONL document

#### Scenario: The unsealed tail is not published

- **GIVEN** a live session with two sealed segments and an unsealed tail
- **WHEN** the archive is published
- **THEN** only the two sealed segments are present in the archive
- **AND** the session is recorded as incomplete

### Requirement: A session SHALL reconstruct byte-identically to its canonical form

Concatenating a session's sealed segments in index order, after decryption and
decompression, SHALL yield exactly the canonical bytes for the sealed range.
Byte-exactness SHALL be asserted against the canonical form, not against the
expanded local transcript, which differs by construction on any machine whose
paths differ.

#### Scenario: Round-trip reconstruction is byte-exact against canonical

- **WHEN** a session is scrubbed to canonical form, segmented, compressed,
  encrypted, then decrypted, decompressed and concatenated
- **THEN** the result is byte-identical to the canonical sealed range

#### Scenario: An unexpectedly missing segment fails reconstruction

- **GIVEN** a manifest listing segments `0000`, `0001`, `0002` with no drop
  tombstone
- **WHEN** the blob for `0001` cannot be retrieved
- **THEN** reconstruction fails with an explicit gap error naming the missing
  segment
- **AND** no partial transcript is written to the local session store

#### Scenario: A deliberately dropped segment reconstructs as a marked gap

- **GIVEN** a manifest in which segment `0001` carries a drop tombstone
- **WHEN** the session is reconstructed
- **THEN** a transcript is produced containing the surrounding segments
- **AND** the gap at `0001` is explicitly marked rather than spliced over
- **AND** the result is distinguishable from an intact session

### Requirement: Segment identity SHALL be the digest of canonical plaintext

Each segment SHALL be identified by the SHA-256 digest of its **canonical
plaintext**. The blob-store object key SHALL be an opaque identifier unrelated
to that digest. A per-session manifest SHALL record the ordered segment
identities, their object keys, their sizes, their seal timestamps, the
publishing machine identifier for each segment, any drop tombstones, and whether
the session is complete.

#### Scenario: The manifest carries the tie-break input

- **WHEN** two divergent branches must be resolved deterministically
- **THEN** the publishing machine identifier for each segment is available from
  the manifest

#### Scenario: An incomplete session is recorded as such

- **WHEN** a session with an unpublished tail is published
- **THEN** the manifest records it as incomplete
- **AND** a consumer can distinguish it from a session that ended and flushed its
  final tail

#### Scenario: Identical content yields identical identity despite encryption

- **GIVEN** two machines that seal byte-identical canonical content
- **WHEN** each encrypts it with non-deterministic encryption
- **THEN** both segments carry the same identity
- **AND** the two are not reported as divergent

#### Scenario: The blob store cannot observe content equality

- **GIVEN** two segments with identical canonical plaintext
- **WHEN** they are uploaded
- **THEN** their object keys differ
- **AND** their stored bytes differ

#### Scenario: The manifest resolves a session to its blobs

- **WHEN** a client reads the manifest for a session
- **THEN** it obtains the ordered list of segment identities and object keys
  without contacting the blob store

#### Scenario: A tampered blob is rejected

- **WHEN** a retrieved blob's decrypted plaintext digest does not match the
  identity recorded in the manifest
- **THEN** the blob is rejected and reconstruction fails with an integrity error
