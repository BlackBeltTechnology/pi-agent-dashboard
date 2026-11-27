# video-transcription Specification

## Purpose
Transcribe local video and audio files into speaker-diarized SRT subtitles written beside the source files. The capability ships as the `video-transcription` pi skill and the `pi-transcribe` CLI, uses Soniox (model `stt-async-v6`) by default and AssemblyAI on request, and is safe to re-run because existing subtitles are skipped.

## Requirements
### Requirement: CLI entry point and exit behavior
The package SHALL expose a `pi-transcribe` bin and the `video-transcription` pi skill. The bin SHALL pass its arguments to the run orchestrator. It SHALL exit with code 1 and print the error message only when the run itself throws, such as a configuration error. A failure on one file SHALL be counted in the summary and SHALL NOT end the run with a non-zero exit code.

The run SHALL log its progress. After discovery it SHALL log `Found <total> files: <n> to process, <m> already transcribed`. For each file it SHALL log `Processing: <file>`, then `  Audio already extracted: <mp3>` or `  Extracting audio...` for video sources, then `  Transcribing via <backend> API...` and `  Saved: <srt>` per backend, and `Done: <file>` when the file was newly transcribed.

#### Scenario: Missing API key aborts the run
- **WHEN** `pi-transcribe` runs with no `SONIOX_API_KEY` in the environment or in any `.env` file
- **THEN** the process prints `SONIOX_API_KEY is not set. ...` to stderr
- **AND** exits with code 1 before it uploads anything

#### Scenario: One failed file does not abort the run
- **WHEN** one of two files fails during transcription
- **THEN** the other file is still processed
- **AND** the summary reports `Failed: 1` and the process does not exit with code 1

#### Scenario: Printed summary
- **WHEN** a run processes at least one file
- **THEN** it prints `=== Transcription Summary ===` followed by the counts for `Total files found`, `Already transcribed`, `Newly transcribed` and `Failed`

#### Scenario: Progress lines
- **WHEN** a run finds 3 files and 1 of them already has its SRT
- **THEN** it logs `Found 3 files: 2 to process, 1 already transcribed`
- **AND** each processed file is logged with `Processing: <file>`

### Requirement: Input discovery
The CLI SHALL resolve its inputs as follows. With no arguments, it SHALL scan `~/Movies`. With exactly one argument that is a directory, it SHALL scan that directory. In every other case, it SHALL treat each argument as an explicit file. A scan SHALL include only regular files in the top level of the directory whose lower-cased extension is `.mkv`, `.mp4`, `.mov`, `.m4a` or `.mp3`. Resolved files SHALL be ordered oldest first by modification time.

#### Scenario: Default directory
- **WHEN** `pi-transcribe` runs with no arguments
- **THEN** it scans `<home>/Movies` for supported media files

#### Scenario: Unsupported explicit file
- **WHEN** an explicit argument is `notes.txt` and that file exists
- **THEN** the run throws `Unsupported file type: notes.txt`

#### Scenario: Unsupported explicit file that does not exist
- **WHEN** an explicit argument is `notes.txt` and no such file exists
- **THEN** the run throws `Not a file: notes.txt`

#### Scenario: Missing explicit file
- **WHEN** an explicit argument does not exist or is not a regular file
- **THEN** the run throws `Not a file: <arg>`

#### Scenario: No media found
- **WHEN** discovery finds no supported files
- **THEN** the CLI logs `No audio/video files found.` and returns zero counts

### Requirement: Idempotent sibling SRT output
For each selected backend, the CLI SHALL write the transcript as UTF-8 to a sibling file whose name replaces the source extension with that backend's suffix. Soniox SHALL use `.srt` and AssemblyAI SHALL use `.diarize.srt`. When exactly one backend is selected, `TRANSCRIBE_SRT_SUFFIX` SHALL override its suffix. When several backends are selected, the override SHALL be ignored. A backend whose sibling file already exists SHALL be skipped. A file whose sibling files exist for every selected backend SHALL be counted as already transcribed and SHALL NOT be processed.

#### Scenario: Re-run skips finished files
- **WHEN** `talk.m4a` and `talk.srt` both exist and the Soniox backend is selected
- **THEN** `talk.m4a` is counted as already transcribed
- **AND** nothing is uploaded for it

#### Scenario: Nothing left to do
- **WHEN** every discovered file is already transcribed
- **THEN** the CLI logs `Nothing to do.` and creates no transcription client

#### Scenario: Both backends write separate files
- **WHEN** `TRANSCRIBE_BACKEND=both` is set for `meeting.mp4`
- **THEN** the run writes `meeting.srt` from Soniox and `meeting.diarize.srt` from AssemblyAI

### Requirement: Backend selection and configuration
The configuration SHALL select backends from `TRANSCRIBE_BACKEND`. The value is case-insensitive. It accepts `soniox`, `assemblyai`, `both`, `all`, or a comma-separated list. Unknown names SHALL be dropped and duplicates SHALL be collapsed. An empty or fully unknown value SHALL fall back to `soniox`. The configuration SHALL look up each selected backend's key in this order: the environment, `.env` in the current working directory, then `.env` in the fallback directory. The fallback directory defaults to the directory of the config module itself (`packages/video-transcription/src/` when run from source), not the package root. The fallback lookup SHALL be skipped when that directory resolves to the current working directory. Soniox uses `SONIOX_API_KEY` and AssemblyAI uses `ASSEMBLY_AI_KEY`. All keys SHALL be resolved before any work starts.

The configuration SHALL also apply these settings:
- `MAX_CHUNK_HOURS` is a positive float. Otherwise the default is 4.5 hours for Soniox and 9 hours for AssemblyAI.
- `MAX_AUDIO_MB` is a whole number of MB. The default is 200 and `0` disables the limit. An unset, empty or whitespace-only value silently uses 200 with no warning. Any other non-whole-number value triggers a warning and falls back to 200.
- `TRANSCRIBE_CONCURRENCY` is a positive integer. A fractional value is truncated. The value is clamped to 1–100, and an invalid value falls back to 8.
- `TRANSCRIBE_LANGUAGE` and `TRANSCRIBE_MAX_SPEAKERS` affect AssemblyAI only.

#### Scenario: Unknown backend falls back
- **WHEN** `TRANSCRIBE_BACKEND=whisper`
- **THEN** only the Soniox backend is selected

#### Scenario: Missing key for a both-run
- **WHEN** `TRANSCRIBE_BACKEND=both` is set, `SONIOX_API_KEY` is set, and `ASSEMBLY_AI_KEY` is missing
- **THEN** loading the configuration throws `ASSEMBLY_AI_KEY is not set...`
- **AND** no audio is uploaded

#### Scenario: .env parsing
- **WHEN** `.env` contains `# comment`, a blank line and `SONIOX_API_KEY="abc"`
- **THEN** the key resolves to `abc` with the quotes removed

#### Scenario: Module-directory .env fallback
- **WHEN** the key is in neither the environment nor `<cwd>/.env`, and `.env` beside the config module contains `SONIOX_API_KEY=abc`
- **THEN** the key resolves to `abc`

#### Scenario: Invalid size limit
- **WHEN** `MAX_AUDIO_MB=1.5`
- **THEN** a warning `Invalid MAX_AUDIO_MB "1.5": expected a whole number of MB >= 0; using 200.` is emitted
- **AND** the limit is set to 200

#### Scenario: Empty size limit
- **WHEN** `MAX_AUDIO_MB` is set to an empty or whitespace-only string
- **THEN** the limit is 200 and no warning is emitted

#### Scenario: No secret in the repository or the package-root tarball
- **WHEN** an API key is kept in `packages/video-transcription/.env`
- **THEN** the file is gitignored by `packages/video-transcription/.gitignore`
- **AND** it is not part of the published package, because the `files` whitelist does not include the package-root `.env`

### Requirement: Audio extraction, size guard, and ffmpeg handling
The CLI SHALL use files with the `.m4a` or `.mp3` extension directly. For `.mkv`, `.mp4` and `.mov` files, it SHALL extract audio once per file into a sibling `.mp3` using `ffmpeg -i <abs src> -vn -acodec libmp3lame -q:a 2 -y <abs out>`. That audio SHALL be shared by every selected backend. An existing sibling `.mp3` SHALL be reused instead of extracting again. The CLI SHALL find ffmpeg and ffprobe through the shared tool registry. A bundled `ffmpeg-static` counts as available. Media paths SHALL be passed to these tools as absolute paths so that a file name starting with `-` cannot be read as an option. Before uploading, the CLI SHALL refuse extracted audio that is larger than `MAX_AUDIO_MB` × 1024² bytes. If the file size cannot be read, the CLI SHALL treat the file as failed rather than upload it.

#### Scenario: ffmpeg absent
- **WHEN** ffmpeg cannot be resolved or `ffmpeg -version` fails
- **THEN** the CLI warns `ffmpeg not found - video files will be skipped (audio-only files will still be processed)`
- **AND** each video file is logged as skipped and counted as failed, while audio files are still transcribed

#### Scenario: Extraction failure cleans up
- **WHEN** the ffmpeg extraction command fails
- **THEN** any partial output `.mp3` is removed
- **AND** the file fails with an error message that starts with `FFmpeg extraction failed:`

#### Scenario: Oversized audio is refused
- **WHEN** the extracted audio is 250 MB and `MAX_AUDIO_MB` is 200
- **THEN** the file fails with `Extracted audio is 250.0 MB, over the 200.0 MB limit (MAX_AUDIO_MB=200); nothing was uploaded...`
- **AND** no provider request is made

### Requirement: Long-recording chunking
The CLI SHALL measure audio duration with `ffprobe -v error -show_entries format=duration -of csv=p=0 <abs path>`. If ffprobe is missing or the probe fails, it SHALL treat the duration as 0. When the duration is 0 or does not exceed the backend's chunk length, it SHALL send the audio in a single request. Otherwise it SHALL cut the audio into consecutive chunks of the chunk length in a temporary directory with the `vt-chunk-` prefix. Each chunk SHALL be re-encoded into `chunk_<n>.mp3` (n starting at 1) with `ffmpeg -y -ss <start> -t <len> -i <abs src> -vn -acodec libmp3lame -q:a 2 <abs dest>`. It SHALL transcribe the chunks in order. Each chunk's cue times SHALL be shifted by the chunk's offset and the cues SHALL be renumbered continuously into a single SRT. A chunk whose shifted SRT is empty SHALL be dropped from the merge. The merged output SHALL end with a trailing newline. The temporary directory SHALL be removed even when transcription fails. A non-positive chunk length SHALL throw an error.

#### Scenario: Ten-hour recording on Soniox
- **WHEN** the audio is 36000 s long and the Soniox chunk length is 16200 s
- **THEN** three chunks starting at 0 s, 16200 s and 32400 s are transcribed
- **AND** the cues in the second chunk are shifted by 16200000 ms and numbered after the last cue of the first chunk

#### Scenario: Unknown duration
- **WHEN** ffprobe is unavailable
- **THEN** the whole file is sent in a single request

#### Scenario: Silent chunk
- **WHEN** the second of three chunks yields no cues
- **THEN** the merged SRT contains only the cues of the first and third chunks, numbered continuously
- **AND** it ends with a trailing newline

### Requirement: Soniox transcription
The Soniox backend SHALL call `https://api.soniox.com/v1` with `Authorization: Bearer <key>`. It SHALL work in five steps:
1. Upload the file with `POST /files` as multipart form data.
2. Create a transcription with `POST /transcriptions` using `model: "stt-async-v6"`, `enable_speaker_diarization: true`, `enable_language_identification: true` and the `file_id`.
3. Poll `GET /transcriptions/{id}` every 2 s, for at most 1800 attempts.
   A status of `error` or `failed` SHALL be terminal and SHALL throw `Transcription failed: <msg>`, where `<msg>` is `error_message`, else `error`, else `Unknown error`.
4. Fetch the transcript with `GET /transcriptions/{id}/transcript` and convert its tokens to SRT.
5. Delete the uploaded file with `DELETE /files/{id}` on success and on failure. Errors from the delete SHALL be ignored.

Error messages SHALL NOT include the API key.

#### Scenario: Provider failure status
- **WHEN** polling returns `status: "error"` with `error_message: "bad audio"`
- **THEN** transcription throws `Transcription failed: bad audio`
- **AND** the uploaded file is still deleted

#### Scenario: Failed status without message
- **WHEN** polling returns `status: "failed"` with neither `error_message` nor `error`
- **THEN** transcription throws `Transcription failed: Unknown error`

#### Scenario: HTTP error
- **WHEN** creating the transcription returns HTTP 401 Unauthorized
- **THEN** it throws `Soniox create failed: HTTP 401 Unauthorized` and the message does not contain the key

#### Scenario: Stuck job
- **WHEN** the status is never `completed` after 1800 polls
- **THEN** it throws `Transcription <id> timed out after 1800 poll attempts`

### Requirement: AssemblyAI transcription
The AssemblyAI backend SHALL use the EU endpoint `https://api.eu.assemblyai.com` with a raw `Authorization: <key>` header that has no `Bearer` prefix. It SHALL work in three steps:
1. Upload the file as `application/octet-stream` with `POST /v2/upload`.
2. Create a transcript with `POST /v2/transcript` using `speech_models: ["universal-3-5-pro","universal-2"]` and `speaker_labels: true`. It SHALL send `language_code` when `TRANSCRIBE_LANGUAGE` is set and `language_detection: true` otherwise. It SHALL send `max_speakers_expected` when `TRANSCRIBE_MAX_SPEAKERS` is set.
3. Poll `GET /v2/transcript/{id}` every 3 s, for at most 1800 attempts.
   A status of `error` SHALL throw `Transcription failed: <error>`, or `Transcription failed: Unknown error` when `error` is absent. When the job never completes, it SHALL throw `Transcription <id> timed out after 1800 poll attempts`.

The backend SHALL retry HTTP 429 and 5xx responses up to 4 times, for uploads, creation and status polls alike. It SHALL wait for the time in `retry-after` when that header is present, and for the poll interval × attempt number otherwise. Unlike Soniox, the backend SHALL NOT delete the uploaded audio.

The backend SHALL build tokens from the transcript as follows. For each utterance with words, it SHALL use those words, each with its own speaker or else the utterance speaker. For an utterance without words, it SHALL use the whole utterance text as one token, skipping blank text. When there are no utterances, it SHALL use the top-level `words`. Speaker labels SHALL map single letters `A`–`Z` to `Speaker 1`–`Speaker 26` and numeric labels `N` to `Speaker N`; a missing label SHALL become `Speaker 1` and any other label SHALL pass through unchanged.

#### Scenario: Rate limited then success
- **WHEN** the upload returns HTTP 429 with `retry-after: 2` and then succeeds
- **THEN** the client waits 2 s and continues the run

#### Scenario: Non-retryable error
- **WHEN** creating the transcript returns HTTP 400
- **THEN** it throws `AssemblyAI create failed: HTTP 400 ...` without retrying

#### Scenario: Speaker labels mapped
- **WHEN** the utterances use speakers `A` and `B`
- **THEN** the SRT cues are labelled `[Speaker 1]` and `[Speaker 2]`

#### Scenario: Provider error status
- **WHEN** polling returns `status: "error"` with no `error` field
- **THEN** it throws `Transcription failed: Unknown error`
- **AND** no delete request is sent for the uploaded audio

#### Scenario: No utterances
- **WHEN** the transcript has no utterances but has top-level words with speaker `2`
- **THEN** the SRT is built from those words labelled `[Speaker 2]`

### Requirement: SRT format
Both backends SHALL produce SRT through the same builder:
- Tokens or words with blank text SHALL be dropped.
- Consecutive tokens SHALL be grouped into one cue until the speaker changes or the cue reaches 5000 ms.
- A token without a speaker SHALL be labelled `Speaker 1`.
- Each cue SHALL consist of its index starting at 1, a line `HH:MM:SS,mmm --> HH:MM:SS,mmm`, a line `[<speaker>] <text>`, and a blank line.
- A transcript without tokens SHALL produce an empty string.

#### Scenario: Speaker change splits cues
- **WHEN** the tokens alternate from speaker `1` to speaker `2`
- **THEN** two cues are emitted, labelled `[1]` and `[2]`

#### Scenario: Timestamp format
- **WHEN** a cue starts at 3723004 ms
- **THEN** its start time is rendered as `01:02:03,004`

### Requirement: Bounded file-level concurrency
The CLI SHALL process pending files through a worker pool with at most `TRANSCRIBE_CONCURRENCY` files in flight (minimum 1). Files SHALL be dispatched oldest first and may finish in any order. Within one file, the selected backends SHALL run one after another against the audio, which is extracted once. The file's outcome SHALL be `transcribed` if any backend wrote a new SRT. Otherwise it SHALL be `failed` if any backend failed, and `already` in all remaining cases. A backend error SHALL be logged as `Failed (<file> via <backend>): <msg>` and SHALL NOT stop the other backends for that file. An exception outside the backends, such as an extraction or size-guard failure, SHALL be caught per file, logged as `Failed (<file>): <msg>`, and counted as failed without stopping the other files.

#### Scenario: Serial mode
- **WHEN** `TRANSCRIBE_CONCURRENCY=1`
- **THEN** files are transcribed one at a time, oldest first

#### Scenario: One backend fails in a both-run
- **WHEN** Soniox succeeds and AssemblyAI fails for the same file
- **THEN** `.srt` is written, the AssemblyAI error is logged, and the file counts as newly transcribed

#### Scenario: File-level failure
- **WHEN** audio extraction throws for `a.mp4`
- **THEN** `Failed (a.mp4): FFmpeg extraction failed: ...` is logged
- **AND** the file counts as failed and the next file is still processed

### Requirement: SRT naming contract with speaker identification
The SRT suffixes that transcription produces SHALL match the names the speaker identification feature uses to find the source media. Speaker identification strips `.diarize.srt`, `.named.srt` or `.srt` from a transcript name to get its media stem. It then looks for sibling media in the fixed order `.mkv`, `.mp4`, `.mov`, `.m4a`, `.mp3`, which is the same set that discovery transcribes.

#### Scenario: AssemblyAI output maps back to its video
- **WHEN** `talk.diarize.srt` was produced from `talk.mp4`, and `talk.m4a` also exists
- **THEN** media resolution for `talk.diarize.srt` returns `talk.mp4`

### Requirement: Media paths are absolute and never parsed as options

Every media path the tool passes to `ffmpeg` or `ffprobe` (inputs, outputs including the audio-decode output, chunk files, discovered files) SHALL be resolved to an absolute path against the spawn working directory at every spawn site, so that it is treated as a path and never as an option, even when its name begins with `-`.

#### Scenario: Dash-leading relative file name

- **GIVEN** an input file named `-i.mp4` in the working directory
- **WHEN** the tool probes and extracts it
- **THEN** ffprobe and ffmpeg SHALL receive its absolute path, open that file, and SHALL NOT interpret the name as a flag

#### Scenario: Dash-leading output path

- **WHEN** a derived output or chunk path would begin with `-`
- **THEN** it SHALL be passed as an absolute path, written there, and SHALL NOT be parsed as an ffmpeg option

#### Scenario: Discovered file in a relative directory

- **GIVEN** a relative input directory containing a file whose name begins with `-`
- **WHEN** the tool discovers and processes it
- **THEN** the path handed to ffmpeg or ffprobe SHALL be absolute

#### Scenario: Audio decode output path

- **GIVEN** an audio decode whose relative output path begins with `-`
- **WHEN** the tool decodes audio, or verifies a voice sample, with ffmpeg or ffprobe
- **THEN** every path argument, including the decode output, SHALL be absolute and SHALL NOT be parsed as an option

#### Scenario: Ordinary paths are unaffected

- **WHEN** the input path is already absolute
- **THEN** processing SHALL behave as before
