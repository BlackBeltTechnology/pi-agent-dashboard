## ADDED Requirements

### Requirement: Hits carry a trust verdict
A search hit SHALL carry a trust verdict describing whether the source files documented by the hit's resolvable DOX rows are still accurate on disk. The verdict SHALL be one of `FRESH`, `STALE`, `MOVED`, `GONE`, or `UNVERIFIED` when the hit has at least one resolvable subject row, and SHALL be null when it does not. The verdict SHALL be individually disableable by the caller.

#### Scenario: Subject unchanged since it was documented
- **WHEN** every checked subject of a hit exists on disk and its content matches the hash recorded when its row was acknowledged
- **THEN** the hit SHALL report verdict `FRESH`

#### Scenario: Subject changed since it was documented
- **WHEN** a checked subject exists on disk but its content no longer matches the acknowledged hash
- **THEN** the hit SHALL report verdict `STALE`

#### Scenario: Subject was renamed
- **WHEN** a checked subject is absent from disk and rename detection identifies exactly one successor path
- **THEN** the hit SHALL report verdict `MOVED`
- **AND** the hit SHALL report the successor path

#### Scenario: Subject is gone
- **WHEN** a checked subject is absent from disk and no unambiguous successor is identified, or the subject lies outside any git repository
- **THEN** the hit SHALL report verdict `GONE`

#### Scenario: No acknowledged hash exists
- **WHEN** a checked subject exists but has no acknowledged hash to compare against
- **THEN** the hit SHALL report verdict `UNVERIFIED`
- **AND** the absence of a hash SHALL NOT be reported as a change

#### Scenario: Hit has no resolvable subject
- **WHEN** a hit is prose that documents no source file
- **THEN** the hit SHALL report a null verdict rather than an inferred one

### Requirement: A hit's verdict aggregates its subject set
The chunker emits heading sections, not table rows, so a hit of doc_type `agents` typically contains many DOX rows. A hit's subject set SHALL be the source files its resolvable rows document, in row order, capped at 8 subjects per hit. The hit's verdict SHALL be the worst-of the per-subject labels in the order `GONE` > `MOVED` > `STALE` > `UNVERIFIED` > `FRESH`, and SHALL carry per-label counts over the checked set TOGETHER WITH the total count of resolvable subjects, so a capped check is never indistinguishable from a full one.

#### Scenario: Worst-of aggregation with counts
- **WHEN** a hit's checked subject set contains two stale subjects, five fresh, and one gone
- **THEN** the hit SHALL report verdict `GONE`
- **AND** the hit SHALL report counts making the 2-stale / 5-fresh / 1-gone composition visible

#### Scenario: Subject cap is visible
- **WHEN** a hit's section documents more than 8 resolvable files
- **THEN** exactly the first 8 rows in row order SHALL be checked
- **AND** the counts SHALL state both how many subjects were checked and how many the section documents in total

### Requirement: Verdicts label but never rank
A trust verdict SHALL NOT influence result ordering. The sequence of hits returned with verdicts enabled SHALL be identical to the sequence returned with verdicts disabled for the same query and options.

#### Scenario: Ordering is unchanged by verdicts
- **WHEN** the same query runs with verdicts enabled and disabled
- **THEN** the returned hits SHALL appear in the same order in both cases

#### Scenario: A stale hit is not demoted
- **WHEN** the best-scoring hit for a query reports verdict `STALE` or `GONE`
- **THEN** it SHALL still be returned at rank 1
- **AND** it SHALL be labelled rather than suppressed

### Requirement: Verdict enrichment is a post-search stage, read-only and bounded
Verdict computation SHALL NOT live inside the store's synchronous search path. It SHALL run as an asynchronous post-search enrichment step. It SHALL NOT write to the index or the filesystem. Freshness SHALL be decided by content hash whenever a hash is computed; a persisted stat baseline recorded at acknowledgement time MAY skip the read but SHALL NOT by itself decide a freshness label except where hashing is impossible. Subjects larger than 1 MB, or detected as binary, SHALL NOT be hashed. Content-coverage scoring, when enabled, SHALL cap the bytes read from a subject file and SHALL skip binary content.

#### Scenario: Enrichment never mutates state
- **WHEN** a search runs with verdicts enabled and some hits report `STALE`, `MOVED`, or `GONE`
- **THEN** no index rows SHALL be inserted, updated, or deleted
- **AND** no file on disk SHALL be created, modified, or removed

#### Scenario: A matching stat baseline skips the read
- **WHEN** a subject's recorded size and modification time match its persisted acknowledgement baseline
- **THEN** the subject's content SHALL NOT be read or hashed

#### Scenario: Oversized and binary subjects are never hashed
- **WHEN** a subject exceeds 1048576 bytes (1 MiB) or is detected as binary
- **THEN** its content SHALL NOT be hashed
- **AND** with a matching stat baseline it SHALL report `FRESH`, otherwise `UNVERIFIED`

#### Scenario: Enrichment latency is recorded against an advisory target
- **WHEN** verdict enrichment runs over a default page whose checked subjects all exist — the median case, with stat-gated hashing, the 8-subject cap, and the hash cap
- **THEN** the measured MEDIAN SHALL be recorded against the advisory 15 ms target in the change's measurements
- **AND** the target SHALL NOT gate CI — it is advisory by decision, not a SHALL
- **AND** rename detection SHALL be batched — one rename-scan subprocess per repository per enrichment, not one per subject — so absent subjects cost the batch, not a spawn each
- **AND** the shipped search latency budget is unchanged because the store's search path is untouched

### Requirement: Content coverage is a separate, opt-in signal
Content-coverage scoring — whether the query's terms appear in a subject file — SHALL be reported as a field distinct from the freshness verdict, and SHALL be disabled by default until calibrated against the bundled golden sets.

#### Scenario: Coverage is off by default
- **WHEN** a search runs with default options
- **THEN** no subject file SHALL be read for coverage scoring

#### Scenario: Coverage does not change the freshness verdict
- **WHEN** coverage scoring is enabled and a subject has low coverage for the query
- **THEN** the freshness verdict SHALL be unaffected
- **AND** coverage SHALL be reported in its own field
