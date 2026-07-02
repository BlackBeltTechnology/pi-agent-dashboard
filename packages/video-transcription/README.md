# @blackbelt-technology/pi-dashboard-video-transcription

Transcribe local video/audio files in-place to speaker-diarized SRT subtitles
using the [Soniox](https://soniox.com) async transcription API. Full TypeScript
port of the standalone `video-transcription` pi skill — no Python. Its only
runtime npm dependency is `@blackbelt-technology/pi-dashboard-shared` (the repo's
safe-subprocess wrapper); everything else rides pi's bundled peers.

Exposed two ways:

- **pi skill** — `.pi/skills/video-transcription` (triggers like `/transcribe`).
- **CLI bin** — `pi-transcribe [directory | file ...]`.

## Prerequisites

- **`ffmpeg`** and **`ffprobe`** on `PATH` — used for audio extraction from
  video, duration probing, and chunk slicing. Audio-only files still need
  `ffprobe` for the long-recording duration guard.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: <https://ffmpeg.org/download.html>
- **`SONIOX_API_KEY`** — resolved from the environment first, then from an
  optional gitignored `.env` file (current directory, then the skill dir). No
  secret is committed in the package.

## Install

```bash
pi install @blackbelt-technology/pi-dashboard-video-transcription
```

Delivery is published + opt-in. The package is NOT auto-loaded by the monorepo.

## Usage

```bash
pi-transcribe                      # scan ~/Movies (default)
pi-transcribe /path/to/recordings  # scan a directory
pi-transcribe a.m4a b.mp4          # transcribe explicit files
```

- **No argument** — scans `~/Movies`.
- **Single directory** — scans it for `.mkv`, `.mp4`, `.m4a`, `.mp3`.
- **One or more file paths** — transcribes exactly those files.

Discovered files are processed oldest-first by modification time. A file is
skipped when a sibling `.srt` already exists (idempotent). Output `.mp3`
(extracted audio) and `.srt` (subtitles) are written alongside each source file.

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `SONIOX_API_KEY` | _(required)_ | Soniox API key. |
| `MAX_CHUNK_HOURS` | `4.5` | Chunk size for recordings over the Soniox 5 h duration limit. |
| `MAX_AUDIO_MB` | `200` | Reserved size guard; `0` disables. |

## Long recordings (>5 h)

Soniox enforces a hard per-request limit on audio **duration** (18000 s / 5 h),
independent of file size. Recordings over the limit are split into
`MAX_CHUNK_HOURS`-sized chunks, transcribed separately, and merged into a single
SRT with correct absolute timestamps — full coverage, no truncation. Duration is
probed via `ffprobe` since the limit is on duration, not megabytes.

## Development

```bash
npm test   # vitest: pure-logic + mocked I/O (no network, no binaries)
```

The bin runs as TypeScript via pi's jiti loader — no build step. Standalone
execution outside pi is out of scope for this package.
