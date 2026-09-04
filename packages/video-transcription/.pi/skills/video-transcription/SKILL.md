---
name: video-transcription
description: Transcribe video and audio files to SRT subtitles with speaker diarization via the Soniox API (default) or AssemblyAI (opt-in). Use when the user wants to transcribe meeting recordings, videos, or audio files. Supports MKV, MP4, MOV, M4A, and MP3. Triggers on "/transcribe", "transcribe my meetings", "transcribe videos in ~/Movies", or any request to convert audio/video to text.
---

# Video Transcription

Transcribe video and audio files in-place to SRT subtitle format with speaker
diarization. Backed by the `pi-transcribe` CLI (a TypeScript port of the
original standalone skill — no Python).

Two backends. Soniox is the default and writes `<name>.srt`. AssemblyAI is
opt-in via `TRANSCRIBE_BACKEND=assemblyai`, uses the EU endpoint, and writes
`<name>.diarize.srt` — a different suffix, so both can transcribe the same file
and you can compare diarization side by side.

`TRANSCRIBE_BACKEND=both` runs them in one pass: audio is extracted once and
fed to both APIs, producing `<name>.srt` and `<name>.diarize.srt` together. Use
this when the user asks to compare diarization or wants both transcripts.

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
- `TRANSCRIBE_BACKEND=assemblyai pi-transcribe ~/Movies` — use AssemblyAI instead of Soniox (writes `.diarize.srt`, needs `ASSEMBLY_AI_KEY`)
- `TRANSCRIBE_BACKEND=both pi-transcribe ~/Movies` — run BOTH backends in one pass (writes `.srt` + `.diarize.srt`; needs both keys)
- `TRANSCRIBE_BACKEND=assemblyai TRANSCRIBE_LANGUAGE=hu pi-transcribe file.m4a` — pin Hungarian instead of auto-detecting
- `MAX_CHUNK_HOURS=4 pi-transcribe ~/Movies` — change the long-recording chunk size (default 4.5h Soniox / 9h AssemblyAI)
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

## Long recordings

Each provider enforces a HARD per-request limit on audio **duration**,
independent of file size: Soniox 18000 s / 5 h, AssemblyAI 10 h. Recordings
longer than the limit are automatically split into `MAX_CHUNK_HOURS`-sized
chunks (default 4.5 h on Soniox, 9 h on AssemblyAI), transcribed separately, and
merged into a single SRT with correct absolute timestamps — full coverage, no
truncation. Override the chunk size with the `MAX_CHUNK_HOURS` env var.

Note: the limit is on duration, not megabytes — a long low-bitrate recording can
be small in size yet still exceed the cap, so the guard probes duration via
ffprobe.

## Prerequisites

- **ffmpeg** (with **ffprobe**) — declared in this package's `pi.tools`
  manifest and resolved through the dashboard tool registry (PATH **or**
  the static npm packages: `ffmpeg-static` for ffmpeg,
  `@ffprobe-installer/ffprobe` for ffprobe — both optionalDependencies
  here). When absent, video files are skipped with a warning; audio-only
  files still process. `pi-dashboard-ensure <package-root>/package.json`
  reports both.
- **The selected backend's API key** — `SONIOX_API_KEY` or `ASSEMBLY_AI_KEY`,
  both declared as `env` probes in `pi.tools`. Same resolver: environment
  first, then an optional gitignored `.env` (current directory, then the skill
  dir). Only the active backend's key is required. No secret ships in the
  package; the bin fails fast with a clear message if the key is unresolved.

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_BACKEND` | `soniox` | `soniox`, `assemblyai`, `both`/`all`, or a comma list. Unknown values fall back to `soniox`. |
| `SONIOX_API_KEY` | _(required for soniox)_ | Soniox API key. |
| `ASSEMBLY_AI_KEY` | _(required for assemblyai)_ | AssemblyAI API key. |
| `MAX_CHUNK_HOURS` | `4.5` / `9` | Chunk size for long recordings; default follows the backend's duration cap. |
| `MAX_AUDIO_MB` | `200` | Reserved size guard; `0` disables. |
| `TRANSCRIBE_CONCURRENCY` | `8` | Files transcribed in parallel. Clamped to `1`–`100`; `1` = serial. |
| `TRANSCRIBE_SRT_SUFFIX` | per backend | Override the sibling subtitle suffix (`.srt` / `.diarize.srt`). |
| `TRANSCRIBE_LANGUAGE` | _(unset)_ | AssemblyAI only: pin a language (e.g. `hu`) instead of auto-detecting. |
| `TRANSCRIBE_MAX_SPEAKERS` | _(unset)_ | AssemblyAI only: hard cap on speaker labels. |

### AssemblyAI backend notes

EU endpoint (`api.eu.assemblyai.com`) for data residency. Runs
`speech_models: ["universal-3-5-pro", "universal-2"]` with `speaker_labels` and
`language_detection` on: `universal-3-5-pro` natively covers 18 languages and
anything outside that set (Hungarian included) automatically falls back to
`universal-2` (99 languages). Speaker letters `A`/`B`/`C` are normalised to
`Speaker 1`/`Speaker 2`/`Speaker 3`, so the SRT format is identical to Soniox's.
