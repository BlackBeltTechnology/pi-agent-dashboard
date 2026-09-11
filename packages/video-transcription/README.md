# @blackbelt-technology/pi-dashboard-video-transcription

Transcribe local video/audio files in-place to speaker-diarized SRT subtitles.
Two interchangeable backends: [Soniox](https://soniox.com) (default) and
[AssemblyAI](https://www.assemblyai.com) (opt-in, for its speaker diarization).
Full TypeScript port of the standalone `video-transcription` pi skill — no
Python. Its only runtime npm dependency is
`@blackbelt-technology/pi-dashboard-shared` (the repo's safe-subprocess
wrapper); everything else rides pi's bundled peers.

Exposed two ways:

- **pi skill** — `.pi/skills/video-transcription` (triggers like `/transcribe`).
- **CLI bin** — `pi-transcribe [directory | file ...]`.

It also ships a second, additive CLI — `pi-voiceid` (skill
`.pi/skills/speaker-id`) — which puts **real names** on the anonymous speaker
labels a diarizer produces, using a persistent local voiceprint library, and
repairs speaker drift on long recordings. See [Speaker ID](#speaker-id-pi-voiceid).

## Prerequisites

- **`ffmpeg`** and **`ffprobe`** on `PATH` — used for audio extraction from
  video, duration probing, and chunk slicing. Audio-only files still need
  `ffprobe` for the long-recording duration guard.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: <https://ffmpeg.org/download.html>
- **An API key for each selected backend** — `SONIOX_API_KEY` (default backend),
  `ASSEMBLY_AI_KEY` (`TRANSCRIBE_BACKEND=assemblyai`), or both
  (`TRANSCRIBE_BACKEND=both`). All use the same resolver: environment first,
  then an optional gitignored `.env` file (current directory, then the skill
  dir). Only the selected backends' keys are required, and they are all
  resolved before any audio is uploaded.
  No secret is committed in the package.

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
skipped when the sibling subtitle file for the active backend already exists
(idempotent). Output `.mp3` (extracted audio) and the subtitle file are written
alongside each source file.

### Backends

| | Soniox (default) | AssemblyAI (`TRANSCRIBE_BACKEND=assemblyai`) |
|---|---|---|
| Key | `SONIOX_API_KEY` | `ASSEMBLY_AI_KEY` |
| Output | `<name>.srt` | `<name>.diarize.srt` |
| Endpoint | `api.soniox.com` | `api.eu.assemblyai.com` (EU data residency) |
| Model | `stt-async-v3` | `speech_models: ["universal-3-5-pro", "universal-2"]` |
| Per-request duration cap | 5 h (chunk default 4.5 h) | 10 h (chunk default 9 h) |

Because the two backends write different suffixes, the same source file can be
transcribed by both — side-by-side SRTs for comparing diarization quality.

`TRANSCRIBE_BACKEND=both` (or `all`, or a comma list such as
`soniox,assemblyai`) runs every backend in one pass:

```bash
TRANSCRIBE_BACKEND=both pi-transcribe ~/Movies
```

Each file is discovered once and, for videos, its audio is extracted once; that
single `.mp3` then feeds both APIs, which run one after the other per file. The
result is `<name>.srt` (Soniox) **and** `<name>.diarize.srt` (AssemblyAI).
Idempotency is per backend: a file already carrying `<name>.srt` from an earlier
Soniox run is not re-transcribed by Soniox, but still gets its missing
`.diarize.srt`. A file is skipped entirely only when every selected backend's
SRT exists. If one backend errors, the other's SRT is still written.

AssemblyAI runs with `speaker_labels` and `language_detection` on.
`universal-3-5-pro` natively covers 18 languages; anything outside that set
(Hungarian included) automatically falls back to `universal-2` (99 languages).
Speaker letters (`A`, `B`, …) are normalised to `Speaker 1`, `Speaker 2`, … so
both backends emit the same SRT format.

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_BACKEND` | `soniox` | `soniox`, `assemblyai`, `both`/`all`, or a comma-separated list. Unknown values fall back to `soniox`. |
| `SONIOX_API_KEY` | _(required for soniox)_ | Soniox API key. |
| `ASSEMBLY_AI_KEY` | _(required for assemblyai)_ | AssemblyAI API key. |
| `MAX_CHUNK_HOURS` | `4.5` / `9` | Chunk size for long recordings; default depends on each backend's duration cap. Applies to all selected backends. |
| `MAX_AUDIO_MB` | `200` | Reserved size guard; `0` disables. |
| `TRANSCRIBE_CONCURRENCY` | `8` | Files transcribed in parallel via a worker pool. Clamped to `1`–`100` (100 = Soniox pending-job cap); `1` = serial. |
| `TRANSCRIBE_SRT_SUFFIX` | per backend | Override the sibling subtitle suffix. Ignored when more than one backend is selected. |
| `TRANSCRIBE_LANGUAGE` | _(unset)_ | AssemblyAI only: pin a language (e.g. `hu`) instead of auto-detecting. |
| `TRANSCRIBE_MAX_SPEAKERS` | _(unset)_ | AssemblyAI only: hard cap on speaker labels (extra speakers get merged). |

## Long recordings (>5 h)

Soniox enforces a hard per-request limit on audio **duration** (18000 s / 5 h),
independent of file size. Recordings over the limit are split into
`MAX_CHUNK_HOURS`-sized chunks, transcribed separately, and merged into a single
SRT with correct absolute timestamps — full coverage, no truncation. Duration is
probed via `ffprobe` since the limit is on duration, not megabytes.

## Speaker ID (`pi-voiceid`)

Give diarized transcripts real names and repair the drift that clustering
diarizers produce on long recordings. Post-hoc relabeling — it does **not**
create diarization. Fully local, CPU-only, no API key; no audio or embedding
leaves the machine.

```bash
pi-voiceid analyze --srt talk.srt                         # drift report, no enrollment
pi-voiceid enroll  --name "Alice" --srt talk.srt --label "Speaker 1"
pi-voiceid label   --srt talk.srt --dry-run               # read the decision table
pi-voiceid label   --srt talk.srt                         # writes talk.named.srt
pi-voiceid list                                           # library + cohort state
pi-voiceid forget  --name "Alice"                         # biometric erasure
```

The source SRT is never overwritten. Full procedure, thresholds and limitations
are in [`.pi/skills/speaker-id/SKILL.md`](.pi/skills/speaker-id/SKILL.md); the
model comparison behind the default is in
[`.pi/skills/speaker-id/BENCHMARK.md`](.pi/skills/speaker-id/BENCHMARK.md).

**Native dependency.** Speaker embeddings come from `sherpa-onnx-node`, declared
as an **optionalDependency** so a platform without a prebuilt binary still
installs and the existing transcription path keeps working. When it is absent,
`pi-voiceid` fails with a message naming the dependency and the install command
rather than a raw module-resolution error.

**Model.** A 28 MB ONNX model, downloaded on demand into
`~/.pi/models/speaker/`. It is **not** vendored into the npm package.

**Voiceprint store.** Default `~/.pi/voiceprints/voiceprints.json`, overridable
with `--store` or `PI_VOICEPRINT_STORE`. This is **biometric-derived data about
identifiable people**: it lives outside the repo by default and must never be
committed. `enroll` also stores embeddings of the source recording's *other*
speakers so the centering mean stays multi-speaker; `forget --recording <id>` is
the instrument that erases those.

## Development

```bash
npm test   # vitest: pure-logic + mocked I/O (no network, no binaries)
```

The bin runs as TypeScript via pi's jiti loader — no build step. Standalone
execution outside pi is out of scope for this package.
