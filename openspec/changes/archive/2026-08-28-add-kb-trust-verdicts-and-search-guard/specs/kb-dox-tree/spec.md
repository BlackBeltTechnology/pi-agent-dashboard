## ADDED Requirements

### Requirement: A DOX row's documented subject is resolvable at query time
The DOX tree SHALL expose the resolution from an indexed `AGENTS.md` row to the source file that row documents, using the same resolution rule as lint, so that lint and query-time verification can never disagree about which file a row describes.

#### Scenario: A row resolves to its documented file
- **WHEN** a row in a directory `AGENTS.md` names a file
- **THEN** it SHALL resolve to the same path that lint resolves it to

#### Scenario: An unresolvable row yields no subject
- **WHEN** a row's path cannot be resolved against its own directory or the repository root
- **THEN** it SHALL yield no subject rather than a guessed one

### Requirement: Acknowledgement records a stat baseline beside the hash
When a documented file's row is acknowledged, the record SHALL persist the file's content hash together with its size and modification time. The record SHALL be versioned so a reader can distinguish a hash-only record from a hash-plus-stat record, and a hash-only record SHALL be readable without error by consumers expecting the stat fields.

#### Scenario: Acknowledgement persists the stat baseline
- **WHEN** a row is acknowledged
- **THEN** the stored record SHALL carry the sha256, the byte size, and the modification time observed at acknowledgement

#### Scenario: A hash-only record degrades gracefully
- **WHEN** a consumer reads a record persisted before stat baselines existed
- **THEN** the absent stat fields SHALL be treated as unknown, not as zero or mismatch

### Requirement: Acknowledged row hashes are readable outside lint
The acknowledged content hash recorded for a documented file SHALL be readable by consumers other than lint, so freshness can be established at query time without re-running a lint pass.

#### Scenario: Query-time freshness uses the acknowledged hash
- **WHEN** a consumer asks whether a documented file has changed since its row was acknowledged
- **THEN** the acknowledged hash SHALL be available without executing a lint run

#### Scenario: A file with no acknowledged hash is not reported as changed
- **WHEN** a documented file has never had a row acknowledged
- **THEN** the absence of a hash SHALL NOT be reported as a change
