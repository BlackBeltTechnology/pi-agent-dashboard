---
name: video-transcription
description: Transcribe video and audio files to SRT subtitle format with speaker diarization using the Soniox API. Use when the user wants to transcribe meeting recordings, videos, or audio files. Supports MKV, MP4, M4A, and MP3 files. Triggers on "/transcribe", "transcribe my meetings", "transcribe videos in ~/Movies", "create subtitles for recordings", or any request to convert audio/video to text.
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

- **ffmpeg** (with **ffprobe**) on `PATH` — for audio extraction, duration
  probing, and chunk splitting. When absent, video files are skipped with a
  warning; audio-only files still process.
- **`SONIOX_API_KEY`** — resolved from the environment first, then an optional
  gitignored `.env` (current directory, then the skill dir). No secret ships in
  the package; the bin fails fast with a clear message if the key is unresolved.

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `SONIOX_API_KEY` | _(required)_ | Soniox API key. |
| `MAX_CHUNK_HOURS` | `4.5` | Chunk size for recordings over the 5 h duration limit. |
| `MAX_AUDIO_MB` | `200` | Reserved size guard; `0` disables. |
