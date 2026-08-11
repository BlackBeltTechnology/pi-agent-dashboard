## ADDED Requirements

### Requirement: A session that is ended always has an end timestamp
Every entry point that places a session into the session map SHALL guarantee that
a session whose `status` is `"ended"` carries an `endedAt`. This includes the
restore path used to rebuild sessions from disk, not only the update and
unregister paths.

#### Scenario: Ending without an explicit timestamp
- **WHEN** a session's `status` is set to `"ended"` and no `endedAt` is supplied
- **THEN** the resulting record SHALL carry an `endedAt`

#### Scenario: Restoring an ended session from disk
- **WHEN** a session is restored into the session map with `status: "ended"` and no `endedAt`
- **THEN** the stored record SHALL carry an `endedAt`
- **AND** the guarantee SHALL NOT depend on the caller having supplied one

#### Scenario: An explicit timestamp is preserved
- **WHEN** a caller ends or restores a session and supplies an `endedAt`
- **THEN** that value SHALL be kept unchanged

### Requirement: End timestamps are derived from evidence
When the server **directly witnesses** a session ending — an explicit end signal
or a user-initiated termination — the time of that event SHALL be recorded as
`endedAt`.

Otherwise the ending was not witnessed: a session reconstructed from disk, a
session registered from history and immediately unregistered, **or a session the
server concluded had ended because a heartbeat or grace period expired**. In
those cases `endedAt` SHALL be derived from evidence of when the session was last
active, in this precedence:

1. the session's recorded last activity,
2. the transcript's last-write time,
3. `startedAt`.

The time at which the end was detected or reconstructed SHALL NOT be used.

#### Scenario: Historical session reconstructed at boot
- **WHEN** the server rebuilds a historical session whose transcript was last written long ago
- **THEN** the derived `endedAt` SHALL reflect that evidence
- **AND** it SHALL NOT be the time of reconstruction

#### Scenario: No evidence available
- **WHEN** no last-activity evidence can be determined for a reconstructed session
- **THEN** `startedAt` SHALL be used as the fallback

#### Scenario: Boot normalisation uses the same rule
- **WHEN** the server normalises a restored session that is not `"ended"` into `"ended"` at boot
- **THEN** it SHALL derive `endedAt` by the same evidence-based rule rather than the current time

#### Scenario: A witnessed ending records the witnessed time
- **WHEN** the server directly witnesses a running session end
- **THEN** `endedAt` SHALL be the time of that ending
- **AND** it SHALL NOT be replaced by an older last-activity value

#### Scenario: A timeout-inferred ending uses evidence, not detection time
- **WHEN** the server concludes a session ended because a heartbeat or grace period expired
- **THEN** `endedAt` SHALL be derived from the session's last activity
- **AND** it SHALL NOT be the time the expiry was detected

#### Scenario: Precedence when both evidence sources exist and disagree
- **WHEN** a reconstructed session has both a recorded last activity and a differing transcript last-write time
- **THEN** the recorded last activity SHALL be used

#### Scenario: History registered then immediately unregistered
- **WHEN** historical sessions are registered and immediately unregistered while a directory is added
- **THEN** each SHALL receive an evidence-derived `endedAt` rather than the current time

#### Scenario: Reconstructing a session must not disturb stored order
- **WHEN** sessions are reconstructed into the session map at boot
- **THEN** supplying their `endedAt` SHALL NOT emit session-reordering side effects for records already present in the stored per-directory order

### Requirement: Ended-tier seeding uses the best known end time
Ended sessions seeded into per-directory order SHALL be ordered by their best
known end time — the observed end where one exists, otherwise the evidence-derived
value — rather than by when they started.

#### Scenario: A long-running session that ended recently
- **WHEN** ended ids absent from the stored order are seeded, and one session started earliest but ended most recently
- **THEN** it SHALL be seeded ahead of sessions that started later but ended earlier

#### Scenario: Stored order is authoritative
- **WHEN** an ended id is already present in the stored per-directory order
- **THEN** supplying its `endedAt` SHALL NOT change its position

### Requirement: Liveness is determined by status, not by the end timestamp
Whether a session is live SHALL be determined by its `status`. Code SHALL NOT
infer liveness from the presence or absence of `endedAt`.

#### Scenario: A record missing its end timestamp is not live
- **WHEN** a record has `status: "ended"` and no `endedAt`
- **THEN** it SHALL NOT be reported as live
- **AND** it SHALL be listed in the ended tier

#### Scenario: A live session has no end timestamp
- **WHEN** a session is running and has never ended
- **THEN** it SHALL have no `endedAt`
- **AND** the absence SHALL NOT be treated as a defect

### Requirement: A transitional ended state carries a truthful timestamp
Where a session is normalised to `"ended"` as a step toward resuming it, and the
resume does not proceed, the record SHALL be left with an `endedAt` derived by
the evidence rule rather than the moment of normalisation.

#### Scenario: Auto-resume abandoned after normalisation
- **WHEN** a zombie session is normalised to `"ended"` to drive the resume flow
- **AND** the resume does not proceed because the session has no session file
- **THEN** the record SHALL carry an evidence-derived `endedAt`
- **AND** that value SHALL NOT be the time the normalisation ran
