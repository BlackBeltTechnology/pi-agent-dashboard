---
name: "speaker-id-enrollment"
description: "Put real names on anonymous diarization labels in SRT transcripts using local speaker voiceprints, and detect speaker drift (one person split across several clusters) in long recordings. Fully offline, CPU-only, no API. Use for \"who is speaker 2\", \"put names on the transcript\", \"label the meeting SRT with real names\", \"the diarization split one person into three\", \"improve diarization on a long recording\", \"enroll my voice\"."
version: 1
created: "2026-08-31"
updated: "2026-08-31"
---

## When to Use

- An SRT has anonymous labels (`[1]`, `[Speaker 2]`) and you want **real names**.
- A long recording's diarization **split one person across several clusters**
  (speaker drift) and you want to detect or repair it.
- You want to know whether a **specific person** speaks in a recording, and when.

Do **not** use this to *create* diarization — it only relabels an existing one.
Generate the SRT first (Soniox via the `video-transcription` skill, or a local
pyannote/sherpa diarizer).

## How It Works

Post-hoc enrollment matching, not a new diarizer:

1. Existing diarization gives anonymous clusters.
2. Each cluster is profiled by a **speaker embedding** model (segments sampled
   *across the whole timeline*, so drift is visible).
3. Cluster centroids are compared by cosine to enrolled **voiceprints**.
4. Clusters above threshold get the name; several clusters may map to one name —
   that is the drift repair.

The embedding model is small (28 MB, ~12 s for a 90-min meeting on CPU) and runs
fully offline via `sherpa-onnx`. Nothing is uploaded.

## Setup (one time)

```bash
python3 -c "import sherpa_onnx"                     # required
ls ~/Documents/.pi/models/speaker/*.onnx            # models must exist
```

If the model dir is empty, download the default (28 MB):

```bash
mkdir -p ~/Documents/.pi/models/speaker && cd ~/Documents/.pi/models/speaker
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx
```

**Model choice is the single biggest accuracy factor — do not "upgrade" to a
bigger model without reading `BENCHMARK.md`.** The 114 MB VoxCeleb ResNet293
measured *worse* (50 %) than this 28 MB one (70.5 %) on Hungarian meeting audio.

## Procedure

Script: `scripts/voiceid.py`. Voiceprints: `~/Documents/.pi/voiceprints/voiceprints.json`.
The source SRT is **never** overwritten; output goes to `*.named.srt`.

### 1. Check for drift first (no enrollment needed)

```bash
python3 scripts/voiceid.py analyze --srt "~/Movies/2026-08-27 10-34-42.srt"
```

Prints per-cluster coherence and a channel-centered cluster-to-cluster cosine
matrix. Pairs ≥ 0.55 are flagged as the same person split in two.

### 2. Enroll a voice

From a cluster of an SRT you have already identified (best — plenty of audio):

```bash
python3 scripts/voiceid.py enroll --name "Csákány Róbert" \
    --srt "~/Movies/2026-08-10 13-03-33.srt" --label "1"
```

From a standalone clip:

```bash
python3 scripts/voiceid.py enroll --name "Kovács Dániel" \
    --audio sample.m4a --start 12 --end 75
```

Re-running **merges** into the existing voiceprint (use `--replace` to reset).
Enroll the same person from several recordings — it is the cheapest accuracy win.

```bash
python3 scripts/voiceid.py list     # library + cross-similarity sanity check
```

### 3. Label a transcript

```bash
python3 scripts/voiceid.py label --srt "~/Movies/2026-08-14 14-48-12.srt" --dry-run
python3 scripts/voiceid.py label --srt "~/Movies/2026-08-14 14-48-12.srt"
```

Always `--dry-run` first and read the decision table. Three gates must all pass
before a name is assigned (`cos ≥ 0.35`, `margin ≥ 0.10`, `vote ≥ 45 %`);
otherwise the anonymous label is **kept**, never guessed.

## Reading the output

| Column | Meaning |
|---|---|
| `cos` | centered cosine of the cluster centroid to the best voiceprint |
| `2nd` / `margin` | runner-up and the gap — a small gap means "could be either" |
| `vote` | share of individual segments that agree with the centroid's pick |

Healthy cross-recording match: `cos` 0.6–0.9, `margin` > 0.5, `vote` > 80 %.
Correct rejection of an un-enrolled person looks like `cos` ≈ 0.0–0.25.

## Pitfalls

- **Centering needs a cohort.** Below 40 embeddings the library-wide mean is not
  trusted and the tool falls back to the recording's own mean, printing a note.
  Raw cosine on single-channel meeting audio saturates (distinct speakers score
  0.93+), so without centering no fixed threshold works. Enroll ≥ 3 voices.
- **Never center by one speaker's own mean** — it cancels the signal. The tool
  always feeds the cohort with *every* speaker of the source recording.
- **Channel mismatch is the dominant failure mode.** A voiceprint from a phone
  memo will score poorly against a Teams capture. Enroll per capture setup.
- **Model dim mismatch**: voiceprints are bound to the model that made them.
  Switching models requires re-enrolling; the tool refuses and tells you.
- **Short segments are noise.** `--min-seg` defaults to 1.2 s; do not lower it.
- **Overlapping speech is not handled** — see Limitations.
- SRT cues from Soniox cut mid-word, so per-cue labels near boundaries are
  unreliable. Judge results at cluster level, not cue level.
- `~/Movies` is an iCloud symlink; large media may be offloaded. `ffmpeg` will
  fail on a dataless file — open it once in Finder to force download.

## Limitations

This is approach (A): post-hoc cluster relabeling. It **cannot**:

- separate **overlapping speech** (two people at once),
- fix a cluster that already merges two speakers (check `coherence` in
  `analyze` — below ~0.55 the cluster itself is impure),
- recover a speaker the diarizer never separated at all.

Those need approach (B), true **TS-VAD / personal VAD**, where the enrollment
embedding is an input to a frame-level model. That requires training and is a
much larger project.

## Verification

```bash
# 1. sanity: label the recording you enrolled from -> must map 1:1 with high cos
python3 scripts/voiceid.py label --srt "<enrollment source>.srt" --dry-run

# 2. rejection: label a recording with different people -> must mostly say UNKNOWN
python3 scripts/voiceid.py label --srt "<unrelated>.srt" --dry-run

# 3. separation: enrolled voices must not resemble each other
python3 scripts/voiceid.py list
```

Measured on this archive: sanity 3/3 (cos 0.89–0.99) with a 4th un-enrolled
cluster correctly rejected at 0.252; cross-recording matches at cos 0.72–0.89.
Full numbers and the model comparison are in `BENCHMARK.md`.
