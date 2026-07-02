# video-transcription Specification

## Purpose
Transcribe local video/audio files in-place to speaker-diarized SRT via the Soniox async API, exposed as a pi skill and a `pi-transcribe` CLI, with long-recording chunking and idempotent re-runs.
## Requirements
### Requirement: Local media transcription to speaker-diarized SRT
The package SHALL transcribe local video (`.mkv`, `.mp4`) and audio (`.m4a`, `.mp3`) files to SRT subtitles with speaker labels using the Soniox async transcription API. For video inputs it SHALL first extract audio to MP3 via `ffmpeg`. Output SRT SHALL be written as a sibling file with the same stem as the original input. Segmentation and timestamp formatting SHALL match the existing skill's behavior (speaker-change boundaries, a 5000 ms maximum segment span, and `HH:MM:SS,mmm` timestamps).

#### Scenario: Audio file transcribed to sibling SRT
- **WHEN** `pi-transcribe` is run on an untranscribed `.m4a` file
- **THEN** the file SHALL be uploaded to Soniox, transcribed with speaker diarization, and a sibling `.srt` SHALL be written with the same stem
- **AND** each cue SHALL carry a `[Speaker N]` label and `HH:MM:SS,mmm --> HH:MM:SS,mmm` timing

#### Scenario: Video file has audio extracted first
- **WHEN** the input is a `.mkv` or `.mp4` and `ffmpeg` is available
- **THEN** audio SHALL be extracted to a sibling `.mp3` before transcription
- **AND** the resulting `.srt` SHALL be derived from the original file's stem

### Requirement: Idempotent, discovery-based runs
The tool SHALL accept no argument (scanning `~/Movies`), a single directory (scanning it), or one or more explicit file paths. Discovered files SHALL be processed oldest-first by modification time. A file SHALL be skipped when a sibling `.srt` already exists. A run SHALL print a summary of files found, already transcribed, newly transcribed, and failed.

#### Scenario: Already-transcribed file skipped
- **WHEN** a media file already has a sibling `.srt`
- **THEN** it SHALL be counted as already transcribed and NOT re-sent to the API

#### Scenario: Explicit file list
- **WHEN** one or more file paths are passed
- **THEN** exactly those files SHALL be transcribed
- **AND** an unsupported extension or missing path SHALL fail with a clear error

### Requirement: Long-recording chunking with merged absolute timestamps
Recordings whose duration exceeds the Soniox per-request limit (5 h) SHALL be split into chunks of at most `MAX_CHUNK_HOURS` (default 4.5 h), transcribed independently, and merged into a single SRT whose cue timestamps are shifted by each chunk's absolute offset and whose cue indices are renumbered sequentially. No audio SHALL be dropped or truncated. Duration SHALL be probed via `ffprobe`, since the limit is on duration, not file size.

#### Scenario: Recording under the limit is a single request
- **WHEN** a recording's probed duration is at or below `MAX_CHUNK_HOURS`
- **THEN** it SHALL be transcribed in one request with no splitting

#### Scenario: Recording over the limit is split and merged
- **WHEN** a recording's probed duration exceeds the chunk size
- **THEN** it SHALL be split into sequential chunks, each transcribed separately
- **AND** the merged SRT SHALL have monotonically increasing absolute timestamps and sequentially renumbered cues covering the full duration

### Requirement: Configuration without committed secrets
The package SHALL read `SONIOX_API_KEY` from the environment, falling back to an optional gitignored `.env` file. No API key SHALL be committed in the package tarball. The API key SHALL NOT appear in logs, errors, or any output. When the key cannot be resolved, the tool SHALL fail fast with an actionable message. `MAX_CHUNK_HOURS` and `MAX_AUDIO_MB` SHALL be configurable via environment variables.

#### Scenario: Missing API key fails fast
- **WHEN** neither the environment nor a local `.env` provides `SONIOX_API_KEY`
- **THEN** the tool SHALL exit with a clear error naming the required variable
- **AND** SHALL NOT attempt any API call

#### Scenario: No secret in the tarball
- **WHEN** the package is published
- **THEN** the `files` whitelist SHALL exclude any `.env`, and no secret material SHALL be present

### Requirement: Dual surface — skill and CLI bin
The capability SHALL be exposed both as a pi skill (`.pi/skills/video-transcription`) and as a `pi-transcribe` CLI bin, sharing one implementation. The skill SHALL invoke the bin and preserve the existing trigger phrases and argument contract.

#### Scenario: Skill invokes the shared bin
- **WHEN** the skill is triggered (e.g. "/transcribe", "transcribe my meetings")
- **THEN** it SHALL run `pi-transcribe` with the same argument contract as the standalone CLI

#### Scenario: Standalone CLI use
- **WHEN** a user runs `pi-transcribe [directory | file ...]` directly
- **THEN** it SHALL behave identically to the skill invocation

### Requirement: Graceful ffmpeg absence
When `ffmpeg`/`ffprobe` are not installed, the tool SHALL skip video inputs with a warning while still processing audio-only inputs. `ffmpeg` failures SHALL clean up any partial output and be reported per file without aborting the whole run.

#### Scenario: ffmpeg missing
- **WHEN** `ffmpeg` is not available on `PATH`
- **THEN** video files SHALL be skipped with a warning and counted appropriately
- **AND** audio-only files SHALL still be transcribed

