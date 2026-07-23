## ADDED Requirements

### Requirement: Bounded-concurrency file-level processing

The tool SHALL process discovered files through a bounded-concurrency worker pool at the
file level, running at most `TRANSCRIBE_CONCURRENCY` files in flight simultaneously (default
`8`, clamped to the range `1`–`100`). Each file SHALL be processed by the same per-file
pipeline (audio extraction for video, long-recording chunking, Soniox transcription, sibling
SRT write) as a serial run; only the scheduling changes. Per-file error isolation SHALL be
preserved: a failure in one file SHALL be counted and SHALL NOT abort other in-flight or
pending files. The final summary (found / already transcribed / newly transcribed / failed)
SHALL report the same totals a serial run would for the same inputs. Chunk-level processing
within a single recording SHALL remain sequential.

#### Scenario: Multiple files processed concurrently
- **WHEN** more untranscribed files are discovered than `TRANSCRIBE_CONCURRENCY`
- **THEN** at most `TRANSCRIBE_CONCURRENCY` files SHALL be in flight at any moment
- **AND** every discovered untranscribed file SHALL eventually be transcribed with its sibling `.srt` written

#### Scenario: One failing file does not abort the batch
- **WHEN** one file in a concurrent batch fails to transcribe
- **THEN** that file SHALL be counted as failed
- **AND** the other files in the batch SHALL still be processed and counted

#### Scenario: Concurrency of one reproduces serial behavior
- **WHEN** `TRANSCRIBE_CONCURRENCY` is `1`
- **THEN** files SHALL be processed one at a time in oldest-first order with deterministic completion order
- **AND** the resulting summary totals SHALL match the concurrent run for the same inputs

#### Scenario: Summary totals are concurrency-invariant
- **WHEN** the same set of inputs is run at `TRANSCRIBE_CONCURRENCY=1` and at a higher value
- **THEN** the found / already-transcribed / newly-transcribed / failed totals SHALL be identical

## MODIFIED Requirements

### Requirement: Idempotent, discovery-based runs

The tool SHALL accept no argument (scanning `~/Movies`), a single directory (scanning it), or
one or more explicit file paths. Discovered files SHALL be **dispatched** oldest-first by
modification time; when concurrency is greater than one, files therefore **start** oldest-first
but MAY **complete** in any order. A file SHALL be skipped when a sibling `.srt` already exists.
A run SHALL print a summary of files found, already transcribed, newly transcribed, and failed.

#### Scenario: Already-transcribed file skipped
- **WHEN** a media file already has a sibling `.srt`
- **THEN** it SHALL be counted as already transcribed and NOT re-sent to the API

#### Scenario: Explicit file list
- **WHEN** one or more file paths are passed
- **THEN** exactly those files SHALL be transcribed
- **AND** an unsupported extension or missing path SHALL fail with a clear error

#### Scenario: Oldest-first dispatch under concurrency
- **WHEN** multiple untranscribed files are discovered and concurrency is greater than one
- **THEN** files SHALL be claimed for processing in ascending modification-time order
- **AND** completion order MAY differ from dispatch order without affecting any file's output

### Requirement: Configuration without committed secrets

The package SHALL read `SONIOX_API_KEY` from the environment, falling back to an optional
gitignored `.env` file. No API key SHALL be committed in the package tarball. The API key SHALL
NOT appear in logs, errors, or any output. When the key cannot be resolved, the tool SHALL fail
fast with an actionable message. `MAX_CHUNK_HOURS`, `MAX_AUDIO_MB`, and `TRANSCRIBE_CONCURRENCY`
SHALL be configurable via environment variables. `TRANSCRIBE_CONCURRENCY` SHALL parse as a
positive integer defaulting to `8`, clamped to the range `1`–`100`; an absent, non-numeric, or
out-of-range value SHALL resolve to a valid in-range value (default for invalid, clamped for
out-of-range).

#### Scenario: Missing API key fails fast
- **WHEN** neither the environment nor a local `.env` provides `SONIOX_API_KEY`
- **THEN** the tool SHALL exit with a clear error naming the required variable
- **AND** SHALL NOT attempt any API call

#### Scenario: No secret in the tarball
- **WHEN** the package is published
- **THEN** the `files` whitelist SHALL exclude any `.env`, and no secret material SHALL be present

#### Scenario: Concurrency env var parsed and clamped
- **WHEN** `TRANSCRIBE_CONCURRENCY` is unset, non-numeric, or less than 1
- **THEN** the effective concurrency SHALL be the default of `8`
- **WHEN** `TRANSCRIBE_CONCURRENCY` exceeds `100`
- **THEN** the effective concurrency SHALL be clamped to `100`
