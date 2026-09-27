## Purpose

Index non-markdown media (images, PDF pages, SRT-aligned audio windows, video clips) into the shared vector space and retrieve them together with markdown sections through a cross-modal kb CLI command.

## ADDED Requirements

### Requirement: Media ingestion into the shared space

The system SHALL provide a `kb embed --media <dir> --set <name>` command that embeds images, PDF pages, audio windows, and video clips under the directory into the vector plane under the named media set, recording for each item its path, modality, optional time window, and a display label. Only modalities validated for the configured model SHALL be embedded; others SHALL be skipped and counted. Re-running SHALL skip unchanged files.

#### Scenario: SRT-aligned audio windows
- **WHEN** a media file has a sibling `.srt`
- **THEN** its audio SHALL be split into windows aligned to cue boundaries
- **AND** each window SHALL record start and end seconds

#### Scenario: PDF pages
- **WHEN** a PDF is indexed
- **THEN** each page SHALL become one item labelled with its page number

#### Scenario: Unchanged file
- **WHEN** the media index runs twice without file changes
- **THEN** the second run SHALL embed zero items

#### Scenario: Unvalidated modality
- **WHEN** video is not validated for the configured model
- **THEN** video files SHALL be skipped and reported as skipped-unvalidated

#### Scenario: Directory outside media roots
- **WHEN** the directory is not under a configured media root
- **THEN** the command SHALL exit non-zero naming the configuration key to change

### Requirement: Cross-modal CLI search

The system SHALL provide a `kb omni-search "<query>"` command that ranks markdown chunks and media items of the configured model together, printing for each hit its rank, path, modality, time window when present, and heading or label. It SHALL support filtering by modality and media set.

#### Scenario: Query returns a recording window
- **WHEN** a query describes content spoken in an indexed recording
- **THEN** results MAY include that recording with its `start-end` window

#### Scenario: Modality filter
- **WHEN** `kb omni-search` is called with `--modality audio`
- **THEN** every returned hit SHALL be an audio item

#### Scenario: Omni disabled
- **WHEN** `omni.enabled` is false or absent
- **THEN** `kb omni-search` SHALL exit non-zero with a one-line message naming how to enable it, and SHALL NOT start the embedding service

### Requirement: No agent tool in this capability

Media retrieval SHALL NOT be exposed as a new agent tool, and `kb_search` SHALL NOT return media items.

#### Scenario: Media indexed, kb_search queried
- **WHEN** media items exist in the vector plane and the agent calls `kb_search`
- **THEN** every hit SHALL reference a markdown source

### Requirement: Private media stays local

Media content, transcripts, and derived evaluation sets SHALL be stored only on the local machine under user-owned paths outside the repository, and logs SHALL record counts and timings but not content.

#### Scenario: Log content
- **WHEN** the media index processes a recording
- **THEN** logs SHALL NOT contain transcript text or media bytes
