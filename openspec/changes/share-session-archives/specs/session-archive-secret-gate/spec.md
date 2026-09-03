## ADDED Requirements

### Requirement: Every published object carrying free text SHALL be scanned before its first upload

A sealed segment SHALL be scanned for known-format secrets before any bytes are
uploaded. A segment that has not completed a scan SHALL NOT be uploaded. The
scan SHALL additionally cover session metadata, goals, and provenance records,
which carry verbatim user prose.

#### Scenario: A credential in the first message is gated

- **GIVEN** a session whose `firstMessage` contains a known-format credential
- **WHEN** its metadata is published
- **THEN** the metadata is flagged and held
- **AND** it is not uploaded merely because the credential sits in metadata
  rather than in a segment

#### Scenario: Goal prose is scanned

- **WHEN** a goal record whose objective contains a known-format credential is
  published
- **THEN** it is flagged and held

#### Scenario: Scanning precedes upload

- **WHEN** a segment is sealed
- **THEN** the scan completes before any blob-store write is attempted for that
  segment

#### Scenario: An unscannable segment is not published

- **GIVEN** a segment whose scan fails with an error
- **WHEN** the publish pipeline runs
- **THEN** the segment is not uploaded
- **AND** it is placed in the quarantine queue

### Requirement: Detection SHALL use known-format patterns only

The scanner SHALL match known credential formats, at minimum provider key
prefixes, JWTs, PEM private-key blocks, and URLs carrying inline credentials.
The scanner SHALL NOT use generic entropy scoring.

#### Scenario: A provider key is detected

- **WHEN** a segment contains a string matching a known provider key format
- **THEN** the segment is flagged with the matching rule and the offending
  location

#### Scenario: An image-bearing segment is not flagged by entropy

- **GIVEN** a segment containing several megabytes of base64 image payload and no
  known-format credential
- **THEN** the segment is not flagged

### Requirement: Flagged segments SHALL park in a quarantine queue without blocking clean segments

A flagged segment SHALL be held in a reviewable queue exposing redact, approve,
and drop actions. Clean segments SHALL continue to publish while flagged
segments await review.

#### Scenario: A flag does not stall the pipeline

- **GIVEN** segments `0004` flagged and `0005` clean
- **WHEN** the publish pipeline runs
- **THEN** `0005` is uploaded
- **AND** `0004` remains in the queue awaiting review

#### Scenario: Approving a held segment publishes it

- **WHEN** a reviewer approves a quarantined segment
- **THEN** the segment is uploaded unchanged

#### Scenario: Redacting a held segment publishes the redacted bytes only

- **WHEN** a reviewer redacts a flagged match and confirms
- **THEN** the uploaded segment contains the redacted bytes
- **AND** the unredacted bytes are never uploaded
- **AND** a redaction marker is published recording the pre-redaction canonical
  identity

#### Scenario: A peer can evaluate the redaction exception

- **GIVEN** a peer holding the pre-redaction canonical identity for a segment
- **WHEN** it encounters the published redacted identity at that index
- **THEN** the marker's recorded pre-redaction identity lets it recognise a
  redaction rather than divergence

#### Scenario: A redacted or dropped segment does not read as divergence

- **GIVEN** a segment whose published identity differs from the publishing
  machine's local canonical identity because it was redacted
- **WHEN** synchronisation runs on the publishing machine
- **THEN** no divergence is reported for that session

#### Scenario: A held segment blocks reconstruction but not publication

- **GIVEN** a session with a quarantined segment at index `0004` and a clean
  segment at `0005`
- **WHEN** `0005` is published
- **THEN** publication succeeds
- **AND** reconstruction of that session fails with an explicit error naming the
  unresolved index, writing no partial transcript

#### Scenario: Dropping a held segment leaves a recorded gap

- **WHEN** a reviewer drops a quarantined segment
- **THEN** the segment is not uploaded
- **AND** the manifest records the index as dropped so reconstruction reports a
  gap rather than silently concatenating across it

### Requirement: Published segments SHALL be deletable

The archive SHALL support deleting a published segment's blob and removing its
manifest reference.

#### Scenario: A leaked segment is withdrawn

- **GIVEN** a published segment later found to contain a credential
- **WHEN** the operator deletes it
- **THEN** the blob is removed from the blob store
- **AND** the manifest no longer references it
- **AND** subsequent reconstruction reports a gap at that index
