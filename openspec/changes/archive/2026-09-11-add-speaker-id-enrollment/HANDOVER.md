# Handover — speaker-id enrollment for video-transcription

Read this first if you are picking this change up cold. It exists because the
prototyping happened in a different working directory (`~/Documents`) and the
implementation belongs here, in `packages/video-transcription/`.

## What is being asked for

Put **real names** on the anonymous speaker labels (`[1]`, `[2]`) that
`pi-transcribe` already writes into SRT files, by matching each label against a
**persistent library of speaker fingerprints (voiceprints)** that is reused
**across different videos**. Cross-video reuse is the explicit user requirement:
enroll a person once, recognise them in every later recording.

A secondary win: the same machinery detects **speaker drift** — a long recording
where the diarizer split one person across several clusters — and repairs it by
mapping several clusters onto one name.

## Status: prototype validated, port not started

A **working Python reference implementation** and a **model benchmark** are in
`reference/`. They are not throwaway sketches — they were run against real
recordings and the numbers in `design.md` come from those runs. Read
`reference/BENCHMARK.md` before making any model or scoring decision; several
obvious-looking choices are measurably wrong.

Nothing has been written into `packages/video-transcription/` yet.

## Decisions already taken with the user

| Question | Decision |
|---|---|
| Integration point | **Separate CLI** (`pi-voiceid`). `/transcribe` stays untouched — lowest risk. Explicitly chosen over auto-labeling during transcription. |
| Language | **TypeScript port**, not shipping the Python script. The package's documented invariant is "full TS port, no Python", and it holds. |
| Native dependency | `sherpa-onnx-node`, as an **optionalDependency**, so a platform without a prebuilt binary still installs and runs the existing transcription path. |

## The one thing to verify before you start

The whole port rests on `sherpa-onnx-node` being usable. This was **already
verified on this machine** (darwin-x64, Node): the module loads, exposes
`SpeakerEmbeddingExtractor`, and produces a 192-dim embedding that matches the
Python binding to ~5e-3 per component on identical audio.

Re-run that probe on your platform before writing code — `npm install` exiting 0
proves nothing for a native package:

```bash
mkdir -p /tmp/probe && cd /tmp/probe && echo '{"name":"p","type":"module"}' > package.json
npm i sherpa-onnx-node@1.13.6
node -e "import('sherpa-onnx-node').then(m=>console.log(Object.keys(m.default).filter(k=>/Speaker/.test(k))))"
```

Expect `[ 'SpeakerEmbeddingExtractor', 'SpeakerEmbeddingManager', 'OfflineSpeakerDiarization' ]`.

Note the Node binding differs from Python in two ways the port must handle:
options are **camelCase** (`numThreads`, not `num_threads`), and
`acceptWaveform` takes an **object** (`{ sampleRate, samples }`). Call
`inputFinished()` before `compute()` — the probe skipped it, which is the likely
source of the small numeric delta above.

## Where to go next

1. `proposal.md` — why, and what changes.
2. `design.md` — the architecture, and the four measured findings that constrain it.
3. `specs/speaker-id-enrollment/spec.md` — the requirements to satisfy.
4. `tasks.md` — an ordered, test-first checklist. Start at 0.1.

## Reference material in this change

| Path | What it is |
|---|---|
| `reference/voiceid.py` | Working Python implementation of the whole feature (enroll / list / analyze / label). The port target. Behaviour here is the spec of record where the written spec is silent. |
| `reference/BENCHMARK.md` | Six-model comparison plus the end-to-end cross-recording validation. Contains the numbers that justify the defaults. |

Both are copies. The originals live in
`~/Documents/.pi/skills/speaker-id-enrollment/` and should be deleted once this
change lands, so there is one implementation, not two.
