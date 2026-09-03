## ADDED Requirements

### Requirement: Synchronisation SHALL be bidirectional and automatic

A background daemon SHALL publish locally sealed segments and retrieve remotely
published index updates without user action. Publication SHALL be debounced so
that a rapidly-appending session does not produce a publish per append.

#### Scenario: A local session appears remotely without user action

- **WHEN** a local session seals a segment and the daemon is running
- **THEN** the segment is published and the index updated with no user
  interaction

#### Scenario: A remote session is listed without being materialised

- **WHEN** another machine publishes a session to the archive
- **THEN** the session is listed locally as a remote session
- **AND** no transcript or metadata sidecar is written to the local slug
  directory until it is opened or resumed

#### Scenario: Rapid appends are debounced

- **WHEN** a session appends continuously for the duration of the debounce window
- **THEN** at most one publish is issued for that window

### Requirement: Merging SHALL be a set union over immutable segments

Reconciling two copies of a session SHALL be the union of their segment digests
ordered by segment index. Merging SHALL NOT rewrite or reorder published
segments.

#### Scenario: A longer copy fast-forwards a shorter one

- **GIVEN** machine A knows of segments `0000-0002` and machine B has published
  `0000-0004` for the same session
- **WHEN** synchronisation runs
- **THEN** both machines' manifests reference `0000-0004`
- **AND** the identities of `0000-0002` are unchanged
- **AND** no segment bytes are fetched merely to reconcile the manifests

#### Scenario: Session metadata is merged field-wise

- **WHEN** two machines publish differing metadata for the same session
- **THEN** the result is a field-level merge
- **AND** no field is lost by wholesale replacement of the record

#### Scenario: A deleted metadata field is not resurrected by merge

- **GIVEN** one machine deleted a metadata field and the other still holds its
  prior value
- **WHEN** the records are merged
- **THEN** the field remains deleted

#### Scenario: A metadata push conflict retries rather than clobbers

- **WHEN** a metadata push is rejected because the index advanced concurrently
- **THEN** the daemon re-reads, re-merges, and retries
- **AND** the concurrently-written fields survive

### Requirement: A session SHALL be claimed before segments are published for it

Publishing a segment for a session SHALL require holding an exclusive claim on
that session. The originating machine SHALL write an explicit claim when the
session is created and SHALL renew it like any other holder. Resuming a session
elsewhere SHALL require transferring the claim. Claims SHALL live on per-session
refs. Renewal SHALL be a fast-forward push and SHALL NOT use a force-push. Each
renewal SHALL publish the holder's next-renewal deadline, and a claim SHALL
become available once that deadline has passed by more than a configured skew
tolerance. A holder SHALL release its claim voluntarily when its session ends.

#### Scenario: The origin's claim exists from creation

- **WHEN** a session is created locally
- **THEN** an explicit claim for it exists before its first segment is published
- **AND** no window exists in which another machine can claim it while the origin
  is writing

#### Scenario: Backfilled sessions are claimed, not exempted

- **GIVEN** sessions that predate the feature and were never created under the
  claim rule
- **WHEN** they are backfilled
- **THEN** each is claimed before its segments are published and released
  afterwards

#### Scenario: The final tail is sealed and published before release

- **GIVEN** a session ending with appends that have not met any seal threshold
- **WHEN** the session ends and its holder releases the claim
- **THEN** the remaining tail is sealed and published first
- **AND** the archived session is not recorded as incomplete

#### Scenario: A refusal names the holder without publishing a hostname

- **WHEN** a claim is refused
- **THEN** the holder is identified to the user by its display alias
- **AND** the index contains no hostname in clear text

#### Scenario: A voluntary release enables immediate handover

- **GIVEN** a session whose holder has ended it and released the claim
- **WHEN** another machine claims it
- **THEN** the claim is granted without waiting for an expiry deadline

#### Scenario: Heartbeats for different sessions do not contend

- **WHEN** two machines renew claims on two different sessions simultaneously
- **THEN** neither renewal is rejected because of the other

#### Scenario: Publication without a claim is refused

- **GIVEN** a machine that does not hold the claim on a session
- **WHEN** it attempts to publish a segment for that session
- **THEN** the publication is refused

#### Scenario: A stale local copy with no unsealed tail is re-materialised before publishing

- **GIVEN** a machine holding segments `0000-0002` locally with no unsealed tail,
  while the archive has `0000-0004`
- **WHEN** it acquires the claim and resumes the session
- **THEN** the local transcript is re-materialised to include `0003-0004` before
  any new segment is sealed
- **AND** the next sealed segment is index `0005`
- **AND** no divergence is reported

#### Scenario: A stale local copy WITH an unsealed tail forks rather than discarding it

- **GIVEN** a machine holding segments `0000-0002` plus unpublished local
  entries, while the archive has `0000-0004`
- **WHEN** it acquires the claim and resumes the session
- **THEN** the unpublished local entries are sealed onto a fork recording
  `forkedFrom`
- **AND** they are neither discarded nor grafted onto the archive continuation

#### Scenario: A losing publisher's branch is retrievable by peers

- **GIVEN** a machine whose segment publish at an index was rejected because
  another machine won that index
- **WHEN** a peer resolves the divergence
- **THEN** the losing branch's identity and object key are available to it
- **AND** both branches' content remains retrievable

#### Scenario: The origin machine cannot publish after handing over the claim

- **GIVEN** machine A originated a session and machine B has acquired its claim
- **WHEN** A's local transcript seals another segment
- **THEN** A does not publish it

#### Scenario: A second machine cannot claim a held session

- **GIVEN** machine A holds a live claim on a session
- **WHEN** machine B attempts to claim it
- **THEN** the attempt is refused and B is told which machine holds the claim

#### Scenario: Concurrent claims resolve to exactly one winner

- **WHEN** two machines attempt to claim the same unclaimed session
  simultaneously
- **THEN** exactly one succeeds and the other is refused

#### Scenario: An abandoned claim expires

- **GIVEN** a claim whose holder stopped heartbeating past the expiry window
- **WHEN** another machine attempts to claim the session
- **THEN** the claim is granted

### Requirement: Divergence SHALL be detected and resolved by forking

Two segments with **differing canonical identities** at the same index for one
session SHALL be treated as divergence, except where the difference is explained
by a published redaction marker. Divergence SHALL be resolved by
retaining the common prefix and recording one branch as a fork with a new
session id and a `forkedFrom` reference. The retained branch SHALL be selected
by a deterministic tie-break in which a published redaction marker outranks an
unredacted segment, and the publishing machine identifier breaks remaining ties,
so that every machine computes the same resolution. A publisher whose segment is
rejected SHALL record its branch in a divergence namespace so that the losing
branch is visible to every peer. Divergent content SHALL NOT be discarded or
overwritten.

#### Scenario: Divergent segments produce a fork

- **GIVEN** two segments with different canonical identities published at index
  `0003` for one session
- **WHEN** synchronisation runs
- **THEN** the common prefix `0000-0002` is retained
- **AND** one branch becomes a new session recording `forkedFrom`
- **AND** both branches' content remains retrievable

#### Scenario: Two machines resolve a fork identically

- **GIVEN** the same divergence observed independently by two machines
- **WHEN** each resolves it
- **THEN** both retain the same branch and fork the same branch

#### Scenario: A redacted branch always outranks an unredacted one

- **GIVEN** divergence at one index where one branch carries a redaction marker
  and the other does not
- **WHEN** the tie-break is applied
- **THEN** the redacted branch is retained
- **AND** the unredacted branch is never promoted over it

#### Scenario: A dropped segment is not resurrected by union merge

- **GIVEN** a segment dropped and tombstoned by the publishing machine
- **WHEN** a peer that still holds that segment's identity synchronises
- **THEN** the segment is not restored to the manifest

#### Scenario: Identical content sealed twice is not a fork

- **GIVEN** two machines that sealed byte-identical canonical content at the same
  index
- **WHEN** synchronisation runs
- **THEN** no fork is created

#### Scenario: Divergence never silently overwrites

- **WHEN** divergence is detected
- **THEN** no published segment is deleted or replaced as part of the resolution

### Requirement: Backfill scope SHALL be configurable and SHALL warn before exceeding remote limits

Initial publication scope SHALL be configurable between full history and a
bounded horizon. The estimated size SHALL be reported before upload begins.

#### Scenario: A full backfill reports its size first

- **WHEN** an operator selects full backfill
- **THEN** the estimated object count and total size are reported before any
  upload

#### Scenario: An estimate over the configured limit warns before proceeding

- **WHEN** the estimate exceeds the configured remote storage limit
- **THEN** the operator is warned and upload does not begin without confirmation
