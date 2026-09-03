---
name: video-transcription
description: Transcribe video and audio files to SRT subtitle format with speaker diarization using the Soniox API. Use when the user wants to transcribe meeting recordings, videos, or audio files. Supports MKV, MP4, MOV, M4A, and MP3 files. Triggers on "/transcribe", "transcribe my meetings", "transcribe videos in ~/Movies", "create subtitles for recordings", or any request to convert audio/video to text.
---

# Video Transcription

Transcribe video and audio files in-place to SRT subtitle format with speaker
diarization. Backed by the `pi-transcribe` CLI (a TypeScript port of the
original standalone skill — no Python).

## Usage

Run the `pi-transcribe` bin, optionally passing a directory or file paths.
Output `.mp3` (extracted audio) and `.srt` (subtitles) files are placed
alongside the source files.

```bash
pi-transcribe [directory | file ...]
```

- **No argument**: scans `~/Movies` (default)
- **Single directory**: scans the specified directory (e.g. a Google Recorder
  `.m4a` export folder)
- **One or more file paths**: transcribes exactly those files

Examples:
- `/transcribe` — transcribe all untranscribed files in `~/Movies`
- `/transcribe /path/to/recordings` — transcribe files in a specific directory
- `pi-transcribe "~/Movies/May 28 at 4-04 PM.m4a" "~/Movies/Feb 2 at 5-05 PM.m4a"` — transcribe specific files
- `MAX_CHUNK_HOURS=4 pi-transcribe ~/Movies` — change the long-recording chunk size (default 4.5h)
- `TRANSCRIBE_CONCURRENCY=4 pi-transcribe ~/Movies` — change how many files transcribe in parallel (default 8)

## Parallel processing

Files transcribe through a bounded worker pool: up to `TRANSCRIBE_CONCURRENCY`
files (default 8) are in flight at once, overlapping the Soniox wait that
dominates each file's wall-clock time. Files are dispatched oldest-first but may
complete in any order. Set `TRANSCRIBE_CONCURRENCY=1` for serial, deterministic
behavior. The value is clamped to `1`–`100` (100 = the Soniox pending-job cap).

## Execution

1. Run `pi-transcribe`, passing the user's directory/file arguments (if any)
2. The bin handles everything: file discovery, audio extraction, API
   transcription, idempotency (skips files that already have a sibling `.srt`)
3. Present the bin's summary output to the user (total found, already
   transcribed, newly transcribed, failed)
4. If there are failures, report which files failed and the error messages

## Long recordings (>5h)

Soniox enforces a HARD per-request limit on audio **duration** (18000 s / 5 h),
independent of file size. Recordings longer than this are automatically split
into `MAX_CHUNK_HOURS`-sized chunks (default 4.5 h), transcribed separately, and
merged into a single SRT with correct absolute timestamps — full coverage, no
truncation. Override the chunk size with the `MAX_CHUNK_HOURS` env var.

Note: the limit is on duration, not megabytes — a long low-bitrate recording can
be small in size yet still exceed 5 h, so the guard probes duration via ffprobe.

## Prerequisites

- **ffmpeg** (with **ffprobe**) — declared in this package's `pi.tools`
  manifest and resolved through the dashboard tool registry (PATH **or**
  the static npm packages: `ffmpeg-static` for ffmpeg,
  `@ffprobe-installer/ffprobe` for ffprobe — both optionalDependencies
  here). When absent, video files are skipped with a warning; audio-only
  files still process. `pi-dashboard-ensure <package-root>/package.json`
  reports both.
- **`SONIOX_API_KEY`** — declared as an `env` probe in `pi.tools`; resolved
  from the environment first, then an optional gitignored `.env` (current
  directory, then the skill dir). No secret ships in the package; the bin
  fails fast with a clear message if the key is unresolved.

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `SONIOX_API_KEY` | _(required)_ | Soniox API key. |
| `MAX_CHUNK_HOURS` | `4.5` | Chunk size for recordings over the 5 h duration limit. |
| `MAX_AUDIO_MB` | `200` | Reserved size guard; `0` disables. |
| `TRANSCRIBE_CONCURRENCY` | `8` | Files transcribed in parallel. Clamped to `1`–`100`; `1` = serial. |
