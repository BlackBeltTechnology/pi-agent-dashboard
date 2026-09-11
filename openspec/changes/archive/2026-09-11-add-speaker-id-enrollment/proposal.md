# Add speaker-id enrollment to video-transcription

## Why

`pi-transcribe` produces speaker-diarized SRT, but the speakers are anonymous —
this package renders `[Speaker 1]`, `[Speaker 2]` (`src/srt.ts`), and older
transcripts from the standalone tool use bare `[1]`, `[2]`. Two problems follow:

1. **Labels mean nothing across videos.** `[1]` in Monday's recording and `[1]`
   in Tuesday's are unrelated. There is no way to ask "where does this person
   speak", or to accumulate a person's contributions over a meeting series.
2. **Long recordings drift.** Clustering diarizers split one person across
   several clusters as their voice, distance or channel shifts. On a real
   88-minute recording, two clusters that the diarizer reported as different
   people scored 0.83 centered cosine — the same speaker, counted twice.

Both are solved by the same mechanism: a persistent, named **voiceprint**
library, matched against the clusters of any new transcript.

## What Changes

A new CLI, `pi-voiceid`, in the existing `video-transcription` package:

- **`enroll`** — build or extend a named voiceprint from a clip or from an
  identified cluster of an existing SRT. Re-enrolling the same person from
  another recording merges into their fingerprint.
- **`list`** — show the library, including a cross-similarity matrix so a
  mis-enrolled voice is visible immediately.
- **`analyze`** — drift report for one SRT: which clusters are actually the same
  person. Needs no enrollment.
- **`label`** — rewrite an SRT with real names, writing a sibling `*.named.srt`
  and never touching the source.
- **`forget`** — remove a voiceprint, or drop one recording's contribution to
  the cohort. `enroll` deliberately embeds the source recording's *other*
  speakers to keep the centering mean multi-speaker, so the store accumulates
  derived data about people who were never enrolled; erasing it must be possible.

Speaker embeddings are computed **locally on CPU** via `sherpa-onnx-node`; no
audio leaves the machine, and no API key is involved. A 90-minute recording
profiles in about 12 seconds.

`/transcribe` and every existing module are **unchanged**. This is additive.

## Impact

- **Affected package:** `packages/video-transcription`
- **New capability spec:** `speaker-id-enrollment`
- **New runtime dependency:** `sherpa-onnx-node` — declared **optional** so the
  existing transcription path still installs where no prebuilt native binary
  exists. Every new module must degrade with a clear error, not a crash, when
  the binding is absent.
- **New external asset:** a 28 MB ONNX model, downloaded on demand into a cache
  directory. Not vendored into the npm package.
- **New persisted state:** the voiceprint library JSON. It contains derived
  embeddings, not audio — but it is still biometric data about identifiable
  people, so its location must be explicit and overridable, and it must never be
  committed.

## Discipline Skills

Tasks in this change trigger these `eng-disciplines` skills (rationale in
`design.md` / `HANDOVER.md`):

- **`security-hardening`** — the voiceprint library is **biometric-derived data**
  about identifiable people (tasks 2.1, 2.10, 8.4, 9.3). Validate that the store
  path is explicit and overridable, never written under `$HOME` when overridden,
  never committed, and never shipped in `npm pack`. Also covers the on-demand
  model download (5.3): verify by size/checksum, refuse a truncated file, leave
  no partial artifact.
- **`doubt-driven-review`** — the native `sherpa-onnx-node` optional dependency
  is an irreversible platform commitment (tasks 0.1–0.4, 4.7). `npm install`
  exiting 0 proves nothing for a native package; the platform-support decision
  must stand up before code is written (see the companion
  `verify-native-npm-dep-platform-support` skill).
- **`performance-optimization`** — a 90-minute recording must profile in ~12 s
  CPU (task 7.6) and must not be buffered whole into memory (task 4.4). That is
  a measured budget on a large-data path, so measure before optimizing.
- **`review-code`** — non-trivial new subsystem (five modules plus a new bin)
  landing in a published package; run the inline review once tests pass, before
  commit.

No new endpoint, job, or external call is introduced, so
`observability-instrumentation` does not apply. `node-inspect-debugger` applies
only if the native binding misbehaves opaquely at runtime.

## Non-goals

- Replacing diarization. This relabels an existing one; it cannot separate
  speakers the diarizer never split.
- **Overlapping speech.** Not addressed. That needs TS-VAD (a frame-level model
  taking the enrollment embedding as input), which is a much larger project.
- Auto-labeling inside `/transcribe`. Explicitly deferred by the user.
