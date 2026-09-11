# Speaker ID Enrollment

## ADDED Requirements

### Requirement: Persistent cross-video voiceprint library

The package SHALL maintain a persisted library of named speaker voiceprints that
is reused across separate recordings. A person enrolled from one video SHALL be
recognisable in any later video without re-enrollment. The library location
SHALL be overridable so that tests and alternate profiles never write to the
default path. Each voiceprint SHALL record the embedding dimension and the model
that produced it.

#### Scenario: Voiceprint enrolled from one recording matches another

- **WHEN** a person is enrolled from recording A and `label` runs on recording B
  in which the same person speaks
- **THEN** the cluster for that person SHALL be assigned their name

#### Scenario: Re-enrollment merges rather than replaces

- **WHEN** an existing name is enrolled again from a second recording
- **THEN** the stored voiceprint SHALL become a weighted combination of both
- **AND** the recording SHALL be added to the voiceprint's source list
- **AND** an explicit replace option SHALL instead discard the previous vector

#### Scenario: Model mismatch is refused

- **WHEN** labeling runs with a model whose name or embedding dimension differs
  from a stored voiceprint's
- **THEN** the run SHALL fail with an error naming the affected voiceprints and
  instructing re-enrollment
- **AND** no SRT SHALL be written

#### Scenario: Same dimension but a different model is still refused

- **WHEN** the active model differs from a stored voiceprint's model but produces
  the same embedding dimension
- **THEN** the run SHALL be refused on the model name
- **AND** the two vectors SHALL NOT be compared

#### Scenario: Concurrent writes do not lose an enrollment

- **WHEN** two processes enroll different people into one library concurrently
- **THEN** both enrollments SHALL be present afterwards
- **AND** an interrupted write SHALL leave either the previous or the complete
  new library, never a truncated store

### Requirement: Erasure of stored biometric-derived data

Enrollment deliberately embeds the source recording's other speakers to keep the
centering pool multi-speaker, so the library accumulates derived data about
people who were never enrolled. The tool SHALL therefore provide erasure: a named
voiceprint SHALL be removable, and a source recording's contribution to the
cohort SHALL be removable exactly rather than approximately. The library SHALL
record which recordings the cohort holds.

#### Scenario: Named voiceprint is removed

- **WHEN** a voiceprint is forgotten by name
- **THEN** its vector and source list SHALL be gone from the library
- **AND** later labeling SHALL NOT assign that name

#### Scenario: A recording's cohort contribution is removed exactly

- **WHEN** a source recording's contribution is forgotten
- **THEN** the resulting cohort mean SHALL equal the mean derived from the
  remaining contributions alone, not an approximation of it
- **AND** the recording SHALL no longer be listed in the cohort

#### Scenario: Forgetting a person removes their embeddings from the pool

- **WHEN** a voiceprint is forgotten by name
- **THEN** the cohort contributions recorded against that name SHALL also be
  removed
- **AND** the cohort SHALL retain the other speakers of those recordings

#### Scenario: Unnamed contributions are not erasable by name

- **WHEN** the cohort holds a contribution from a speaker who was never enrolled
  and therefore carries no name
- **THEN** listing the library SHALL show that contribution as unnamed
- **AND** removing it SHALL require forgetting its source recording

#### Scenario: A forgotten recording may contribute again

- **WHEN** a recording's contribution has been forgotten and enrollment runs
  against that media again
- **THEN** it SHALL contribute again rather than be rejected as already seen

#### Scenario: Mixed-model contributions are refused, not discarded

- **WHEN** the active model differs from the model recorded on a stored cohort
  contribution
- **THEN** the run SHALL be refused
- **AND** the stored contributions SHALL NOT be silently reset

#### Scenario: Erasure is order-independent

- **WHEN** the mean is derived from stored contributions
- **THEN** they SHALL be summed in a defined, stable order so that the result
  does not depend on storage or iteration order

#### Scenario: The same audio does not contribute twice

- **WHEN** enrollment runs against a recording whose content was already
  contributed, reached by a different path or filename
- **THEN** the cohort SHALL be unchanged

#### Scenario: Cohort contents are inspectable

- **WHEN** the library is listed
- **THEN** the cohort size and the recordings contributing to it SHALL be shown

### Requirement: Stored vectors are centered at comparison time, not at rest

Voiceprint vectors SHALL be stored uncentered. Centering SHALL be applied to both
compared vectors at comparison time using the mean current for that run, so that
a later enrollment which shifts the cohort mean does not invalidate previously
stored voiceprints. A source recording SHALL contribute to the cohort exactly
once regardless of how many times a speaker from it is enrolled.

#### Scenario: Enrolling a new person does not invalidate earlier voiceprints

- **WHEN** a new person is enrolled, changing the cohort mean, and an earlier
  voiceprint is then matched
- **THEN** the earlier voiceprint SHALL still match its speaker
- **AND** no stored vector SHALL have been rewritten

#### Scenario: Re-enrollment does not double-count the cohort

- **WHEN** a person is re-enrolled from a recording already present in the cohort
- **THEN** their voiceprint SHALL be merged
- **AND** the cohort sum and count SHALL be unchanged

#### Scenario: Which centering space was used is reported

- **WHEN** a match is reported
- **THEN** the output SHALL state whether the cohort mean or the recording
  fallback mean produced the score

#### Scenario: Library location is overridable

- **WHEN** a store path is supplied by flag or environment variable
- **THEN** that path SHALL be read and written instead of the default
- **AND** the default path SHALL NOT be created

### Requirement: Local, offline speaker embedding

Speaker embeddings SHALL be computed locally on CPU. No audio, and no derived
embedding, SHALL be transmitted off the machine. The embedding runtime SHALL be
an optional dependency: when its native binary is unavailable, the package's
existing transcription commands SHALL continue to install and run.

#### Scenario: Embedding runtime unavailable

- **WHEN** a speaker-id command runs and the native embedding binding cannot be
  loaded
- **THEN** the command SHALL fail with an actionable message naming the missing
  dependency
- **AND** it SHALL NOT crash with an unhandled module-resolution error

#### Scenario: Transcription unaffected

- **WHEN** the native embedding binding is absent
- **THEN** existing transcription commands SHALL run normally

#### Scenario: Source media cannot be located

- **WHEN** a command needs audio for an SRT and no media is given or found
  beside it
- **THEN** the command SHALL fail naming the paths it tried
- **AND** SHALL NOT emit a partial result

#### Scenario: Explicit audio path overrides discovery

- **WHEN** an audio path is supplied
- **THEN** that file SHALL be used instead of any sibling media discovered
  beside the SRT

#### Scenario: Several sibling media files resolve deterministically

- **WHEN** more than one candidate media file sits beside the SRT
- **THEN** a fixed extension precedence SHALL decide, independent of directory
  order

#### Scenario: Media shorter than the transcript is refused

- **WHEN** the resolved media is shorter than the transcript's last cue end
  beyond tolerance
- **THEN** the command SHALL refuse rather than embed time ranges that do not
  exist

#### Scenario: Trailing silence is not a mismatch

- **WHEN** the resolved media is longer than the transcript's last cue end
- **THEN** the command SHALL proceed

#### Scenario: Unknown duration skips the check

- **WHEN** the media duration cannot be determined because the probe tool is
  absent or its output unparseable
- **THEN** the check SHALL be skipped with a reported note rather than treated
  as a mismatch

#### Scenario: Model absent

- **WHEN** the configured embedding model file is not present
- **THEN** the tool SHALL either fetch it into the cache directory or fail with
  a message stating the expected path and how to obtain it

### Requirement: Cluster relabeling with explicit rejection

The tool SHALL assign a name to an anonymous SRT cluster only when the match
passes an absolute similarity threshold, a margin over the runner-up, and a
minimum share of agreeing segments. When any gate fails the original anonymous
label SHALL be preserved. Multiple clusters MAY be assigned the same name.

#### Scenario: Cluster with too few sampled segments is not named

- **WHEN** a cluster yields fewer than the minimum number of sampled segments,
  so its vote share is trivially satisfied
- **THEN** its original label SHALL be preserved
- **AND** the reason SHALL name the insufficient segment count

#### Scenario: A single enrolled voiceprint leaves no runner-up

- **WHEN** exactly one voiceprint is enrolled, so neither the margin nor the
  vote gate can discriminate
- **THEN** the absolute threshold SHALL be raised by the margin minimum
- **AND** the report SHALL state that the margin and vote gates were not
  evaluated

#### Scenario: Segment sampling is deterministic

- **WHEN** the same cluster is profiled twice from the same input
- **THEN** the same segments SHALL be sampled and the same vote share reported

#### Scenario: Confident match is renamed

- **WHEN** a cluster passes every gate that applies against exactly one
  voiceprint
- **THEN** every cue of that cluster SHALL carry that name in the output

#### Scenario: Threshold raises do not stack

- **WHEN** both the single-voiceprint condition and the small-cohort fallback
  apply to the same run
- **THEN** the absolute threshold SHALL be raised by one margin minimum, not two
- **AND** the report SHALL name the active reasons

#### Scenario: Unknown speaker is not named

- **WHEN** a cluster's best similarity falls below the threshold
- **THEN** its original label SHALL be preserved in the output
- **AND** the reason SHALL be reported

#### Scenario: Ambiguous match is not named

- **WHEN** a cluster's two best voiceprints are within the margin of each other
- **THEN** its original label SHALL be preserved
- **AND** the reason SHALL distinguish ambiguity from a below-threshold match

#### Scenario: Drift is repaired

- **WHEN** two clusters of one recording both match the same voiceprint
- **THEN** both SHALL be assigned that name
- **AND** the merge SHALL be reported

#### Scenario: No cluster qualifies

- **WHEN** no cluster passes the gates
- **THEN** no output file SHALL be written
- **AND** the command SHALL report that nothing was renamed

### Requirement: Source transcripts are never modified

Labeling SHALL write a sibling output file and SHALL leave the input SRT byte-
identical. Cue indices, timestamps and text SHALL be preserved; only the speaker
tag SHALL change.

#### Scenario: Output is a sibling file

- **WHEN** labeling succeeds for an input SRT
- **THEN** a separate output file SHALL be written
- **AND** the input file SHALL be unchanged

#### Scenario: Overwriting the source is refused

- **WHEN** the resolved output path is the same file as the input
- **THEN** the command SHALL fail without writing

#### Scenario: Output path is selectable

- **WHEN** an explicit output path is supplied
- **THEN** it SHALL be written instead of the default sibling path

#### Scenario: An already-named transcript is refused by default

- **WHEN** the input SRT carries any label that is not `Speaker <n>` or a bare
  `<n>`, including a role label
- **THEN** the command SHALL refuse rather than treat the label as a cluster
- **AND** an explicit relabel option SHALL allow it

#### Scenario: A hard link to the source is not a different file

- **WHEN** the output path is a hard link or a case-only alias of the input
- **THEN** the command SHALL refuse, identifying the file by device and inode
  rather than by resolved path

#### Scenario: The same-file refusal precedes the decision to write

- **WHEN** the output resolves to the input AND no cluster would qualify
- **THEN** the command SHALL fail on the output path rather than exit
  successfully reporting that nothing was renamed

#### Scenario: Relabeling preserves names already assigned

- **WHEN** an already-named transcript is relabeled
- **THEN** clusters whose existing name is in the library SHALL be left
  untouched
- **AND** only still-anonymous clusters SHALL be decided

#### Scenario: Dry run writes nothing

- **WHEN** a dry-run option is given
- **THEN** the decision report SHALL be printed
- **AND** no file SHALL be created

### Requirement: Channel-compensated scoring

Similarity SHALL be computed after subtracting a mean embedding derived from a
multi-speaker pool from both compared vectors. A single speaker's own mean SHALL
NOT be used. When the library-wide cohort is too small to be trusted, the tool
SHALL fall back to the mean of the recording being labeled and SHALL report that
it has done so.

#### Scenario: Cohort mean is used once large enough

- **WHEN** the cohort holds at least the minimum number of embeddings
- **THEN** the library-wide mean SHALL be used for both voiceprints and clusters

#### Scenario: Small cohort falls back and says so

- **WHEN** the cohort is below the minimum
- **THEN** the recording's own multi-speaker mean SHALL be used
- **AND** the fallback SHALL be reported
- **AND** the absolute threshold SHALL be raised by the margin minimum, since
  the calibrated thresholds were not measured in that space

#### Scenario: A dominated pool cannot supply a centering mean

- **WHEN** a centering pool holds fewer than two speakers, or one speaker
  exceeds the dominance share of its audio duration, so its mean approximates a
  single speaker's own mean
- **THEN** the tool SHALL report that it cannot compensate
- **AND** SHALL rename nothing

#### Scenario: The dominance test applies to the cohort too

- **WHEN** a cohort has reached the minimum embedding count but is dominated by
  one speaker
- **THEN** it SHALL be rejected as a centering pool on the same terms as a
  recording-level pool

#### Scenario: Single-cluster recording

- **WHEN** a recording yields only one cluster, so no multi-speaker mean exists
  for it and the cohort is unavailable
- **THEN** the tool SHALL report that it cannot compensate rather than centering
  on that speaker's own mean

### Requirement: Drift analysis without enrollment

The tool SHALL report, for a single SRT and with no voiceprints enrolled,
per-cluster internal coherence and the pairwise similarity between clusters,
flagging pairs likely to be the same speaker.

#### Scenario: Same speaker split across clusters is flagged

- **WHEN** two clusters exceed the drift threshold
- **THEN** the pair SHALL be reported as likely one speaker

#### Scenario: Impure cluster is visible

- **WHEN** a cluster's internal coherence is low
- **THEN** the reported coherence SHALL make that visible

#### Scenario: Nothing to compare

- **WHEN** the SRT has fewer than two labeled clusters
- **THEN** the command SHALL report that and exit without error

#### Scenario: Non-speaker brackets are not clusters

- **WHEN** cues carry a non-speaker bracket such as a sound annotation
- **THEN** those cues SHALL be treated as unlabeled
- **AND** they SHALL NOT form a cluster nor make the transcript count as
  already-labeled
