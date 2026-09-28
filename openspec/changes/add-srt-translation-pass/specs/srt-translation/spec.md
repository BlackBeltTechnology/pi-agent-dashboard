## Purpose

Translate an existing subtitle file into a target language while guaranteeing that every cue survives the round trip with its timing, ordering, and speaker attribution intact — so a translated transcript remains a faithful record of the recording rather than a plausible summary of it.

## ADDED Requirements

### Requirement: Source integrity is established before translating

The system SHALL verify that it has parsed every cue physically present in the source file, and SHALL fail rather than translate a partially-parsed source. A source that cannot be fully parsed is reported, never silently shortened.

#### Scenario: Every timing line in the source is accounted for

- **WHEN** a source SRT is read
- **THEN** the number of parsed cues is compared against an independent count of timing lines in the file
- **AND** a mismatch aborts that file with an error naming both counts and the first unaccounted-for position

#### Scenario: Fused cues without a separating blank line are detected

- **WHEN** two cue timing lines appear in one blank-line-delimited block
- **THEN** the timing-line count exceeds the parsed cue count
- **AND** the file is aborted rather than translating a source whose second cue was absorbed as text

#### Scenario: Tolerance matches the parser

- **WHEN** the source uses CRLF line endings, a byte-order mark, or whitespace-only separators
- **THEN** the integrity count tolerates those forms exactly as the parser does
- **AND** a file the parser accepts is never rejected by the count

#### Scenario: Empty or unparseable source

- **WHEN** the source contains no cues
- **THEN** the file is reported as an error and no output is written

### Requirement: Cue-for-cue translation with preserved timing

The system SHALL read an existing SRT file and emit a translated SRT containing exactly the same number of cues, in the same order, with the same timing values. Only the spoken text of each cue is replaced with its translation.

#### Scenario: Timing and ordering preserved

- **WHEN** an SRT with N cues is translated
- **THEN** the output contains exactly N cues
- **AND** each output cue's start and end time denote the same millisecond values as the corresponding input cue
- **AND** cue order is unchanged

#### Scenario: Non-canonical timestamp separators are normalised

- **WHEN** the source uses `.` as the millisecond separator
- **THEN** the output uses the canonical `,` separator
- **AND** the millisecond values are unchanged
- **AND** the normalisation is reported as a note rather than treated as a failure

#### Scenario: Speaker label is preserved

- **WHEN** a cue's text carries a leading speaker label such as `[Speaker 2]`
- **THEN** the same label appears at the start of the translated cue
- **AND** the label text itself is not translated
- **AND** any normalisation of surrounding whitespace in the label is reported rather than silent

#### Scenario: Cues without spoken text are passed through

- **WHEN** a cue contains only a sound annotation such as `[music]`, or has no spoken text at all
- **THEN** the cue is emitted unchanged, is still counted toward the total, and is not sent to the translation backend

### Requirement: Total-cue-count guarantee

The system SHALL verify that the translation backend returned a result for every cue it was given, and SHALL fail rather than emit a file with missing, extra, duplicated, or reordered cues. Silent truncation is not an acceptable outcome.

#### Scenario: Identifiers are positional, not source-derived

- **WHEN** cues are sent to the backend
- **THEN** each carries its ordinal position as its identifier
- **AND** source index values are carried separately and are not used as identifiers, so a duplicated or synthesised source index cannot make two cues indistinguishable

#### Scenario: Backend omits cues

- **WHEN** the backend returns no result for one or more sent positions
- **THEN** the batch is retried once as two halves
- **AND** if the retry still omits cues, the file fails with an error naming the missing positions

#### Scenario: Backend returns a position more than once

- **WHEN** the same position appears more than once in a reply
- **THEN** the batch is treated as failed and follows the retry-then-fail path
- **AND** per-position counts, not mere membership, are compared so a duplicate cannot pass unnoticed

#### Scenario: Backend returns an unsent position

- **WHEN** the reply contains a position that was not sent
- **THEN** the batch is treated as failed and follows the retry-then-fail path

#### Scenario: Reply is unparseable

- **WHEN** a reply cannot be mapped unambiguously to positions
- **THEN** the batch is treated as failed and follows the retry-then-fail path

#### Scenario: Reply reorders the cues

- **WHEN** a reply returns every sent position exactly once but out of order
- **THEN** the batch is treated as failed and follows the retry-then-fail path

#### Scenario: A cue with spoken text comes back blank

- **WHEN** a cue whose source text is substantive comes back empty or whitespace-only
- **THEN** the batch is treated as failed and follows the retry-then-fail path

#### Scenario: A refractory cue does not fail the whole file

- **WHEN** a single cue repeatedly comes back blank across the retry
- **THEN** that cue's source text is emitted unchanged and reported
- **AND** the file is not failed on account of one cue

#### Scenario: No partial output on failure

- **WHEN** a file ultimately fails
- **THEN** no output file is written for that file
- **AND** any pre-existing output file at that path is left untouched
- **AND** other files in the same run are unaffected

#### Scenario: Successful run reports coverage

- **WHEN** a file is translated successfully
- **THEN** the run reports the number of cues translated and the number passed through
- **AND** the two together equal the number of cues in the source

### Requirement: Sibling output naming

The system SHALL write the translated subtitles to a sibling of the source SRT, named by replacing the source's final `.srt` extension with the target language code, so that every source file maps to a distinct output and coexists with other backends' outputs.

#### Scenario: Backend-suffixed source keeps its suffix

- **WHEN** the source is `talk.diarize.srt` and the target is English
- **THEN** the output is `talk.diarize.en.srt`

#### Scenario: Distinct sources do not collide

- **WHEN** `talk.srt` and `talk.diarize.srt` both exist
- **THEN** their outputs are `talk.en.srt` and `talk.diarize.en.srt`, and neither overwrites the other

#### Scenario: Existing translations are not used as sources

- **WHEN** a directory is scanned for sources
- **THEN** a file matching an already-translated naming pattern for any language is not treated as a source
- **AND** an existing translation is reported as skipped rather than translated again

#### Scenario: Extension matching is case-insensitive

- **WHEN** the source extension is upper-case
- **THEN** it is recognised as a subtitle file and its output replaces that extension

### Requirement: Freshness and idempotency

The system SHALL skip a file whose output already exists and is at least as new as its source, SHALL re-translate when the source is newer, and SHALL offer an explicit override.

#### Scenario: Up-to-date output is skipped

- **WHEN** the output exists and is newer than the source
- **THEN** the file is skipped without calling the backend, and the skip is reported

#### Scenario: Equal timestamps are treated as up to date

- **WHEN** the output and source have identical modification times
- **THEN** the file is skipped, since re-translation after a copy that preserves timestamps is not warranted

#### Scenario: Stale output is refreshed

- **WHEN** the output exists but the source has been modified more recently
- **THEN** the file is translated again

#### Scenario: Forced re-translation

- **WHEN** the override is requested
- **THEN** the file is translated regardless of existing output

### Requirement: Configuration without committed secrets

The system SHALL resolve its credential and settings from the environment, and SHALL never write the credential into output files, logs, or error messages.

#### Scenario: Credential is required only when there is work

- **WHEN** the run has at least one file to translate and no credential is resolvable
- **THEN** the run fails before sending any request, naming the environment variable to set

#### Scenario: No work means no credential required

- **WHEN** every candidate file is skipped as up to date, or no subtitle files are found at all
- **THEN** the run reports that outcome successfully without requiring a credential

#### Scenario: Both `.env` locations are honoured

- **WHEN** the credential is present only in the current directory's `.env`, or only in the package `.env`
- **THEN** it is found in either case

#### Scenario: Target language is validated

- **WHEN** the target language is not a well-formed language code
- **THEN** the run fails naming the offending value, and no path is constructed from it

#### Scenario: Target language default and override

- **WHEN** no target language is specified
- **THEN** English is used
- **AND** an explicit target language overrides the default

#### Scenario: Credential never surfaces

- **WHEN** the backend returns an error
- **THEN** the reported message does not contain the API key

### Requirement: Transport failure recovery

The system SHALL retry transient backend failures using the same backoff convention the package already applies to its other backends, SHALL bound each request in time, and SHALL distinguish a transport failure from a verification failure in its reporting.

#### Scenario: Rate limit is retried

- **WHEN** the backend responds with a rate-limit or server-error status
- **THEN** the request is retried with backoff, honouring a retry-after hint when present

#### Scenario: Connection failures are retried

- **WHEN** a request fails at the transport level rather than returning a status
- **THEN** it is retried under the same bounded backoff, and abandoned after the attempt bound

#### Scenario: A hung request does not stall the run

- **WHEN** the backend accepts a connection but never responds
- **THEN** the request times out rather than blocking indefinitely and is treated as a transient failure

#### Scenario: Transport failure is reported distinctly

- **WHEN** a file fails because the backend could not be reached
- **THEN** the report distinguishes it from a file that failed cue verification

#### Scenario: Per-file independence

- **WHEN** one file in a multi-file run fails
- **THEN** the remaining files are still processed
- **AND** the summary reports successes and failures separately
