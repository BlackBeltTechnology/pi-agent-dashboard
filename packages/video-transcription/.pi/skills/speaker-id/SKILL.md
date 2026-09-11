---
name: speaker-id
description: Put real names on the anonymous speaker labels ("[1]", "[Speaker 2]") in a diarized SRT using a persistent library of local voiceprints, and detect or repair speaker drift (one person split across several clusters) in long recordings. Fully local, CPU-only, no API key. Use for "who is speaker 2", "put names on the transcript", "label the meeting SRT", "the diarization split one person into three", "enroll my voice". Backed by the `pi-voiceid` CLI.
---

# Speaker ID enrollment

Give diarized transcripts real names, and repair the drift that clustering
diarizers produce on long recordings. Post-hoc relabeling — it does **not**
create diarization, it relabels an existing one.

```bash
pi-voiceid analyze --srt talk.srt            # drift report, no enrollment needed
pi-voiceid enroll  --name "Alice" --srt talk.srt --label "Speaker 1"
pi-voiceid label   --srt talk.srt --dry-run  # always dry-run first
pi-voiceid label   --srt talk.srt            # writes talk.named.srt
```

The source SRT is **never** overwritten. Everything runs locally on CPU via
`sherpa-onnx`; no audio or embedding leaves the machine.

## How it works

1. Each anonymous cluster is profiled with a speaker-embedding model, sampling
   segments **across the whole timeline** (drift is temporal).
2. Cluster centroids are centered (a multi-speaker mean subtracted) and compared
   by cosine to the enrolled voiceprints.
3. A cluster is named only when the absolute threshold, the margin over the
   runner-up, and a minimum share of agreeing segments all pass. Otherwise the
   anonymous label is kept — never guessed.
4. Several clusters may map to one name: that is the drift repair.

## Setup (one time)

The embedding model is not vendored. On first `enroll`/`label` it is fetched
into `~/.pi/models/speaker/` (28 MB). Model choice is the single biggest
accuracy factor — see [BENCHMARK.md](BENCHMARK.md). **Do not "upgrade" to a
bigger model without re-running the benchmark**: the 114 MB VoxCeleb leader
scored *worse* than the 28 MB default on real meeting audio.

The native binding `sherpa-onnx-node` is an **optional dependency**. When it is
absent, transcription still works and `pi-voiceid` fails with an actionable
message naming the dependency and the install command.

## Voiceprint library

Default store: `~/.pi/voiceprints/voiceprints.json`. Override with `--store` or
the `PI_VOICEPRINT_STORE` env var. This is **biometric-derived data about
identifiable people**: it lives outside the repo by default, it is overridable,
and it must never be committed. If you point `--store` inside a repository, add
it to that repo's `.gitignore`.

`enroll` also embeds the source recording's **other** speakers, so the centering
mean stays multi-speaker (centering one speaker by their own mean cancels the
signal). Those third parties therefore end up in the store as unnamed
contributions. Erase with `forget`:

```bash
pi-voiceid forget --name "Alice"        # drops Alice's voiceprint + her contributions
pi-voiceid forget --recording <id>      # drops a whole recording's contributions
pi-voiceid list                         # shows the cohort and which clusters are unnamed
```

A never-enrolled speaker swept into the pool has no name, so only
`forget --recording <id>` reaches them. `list` makes that visible.

## Procedure

### 1. Check for drift first

```bash
pi-voiceid analyze --srt talk.srt
```

Prints per-cluster coherence and a channel-centered cluster-to-cluster cosine
matrix. Pairs at or above `--drift-threshold` (default 0.55) are flagged as
likely the same person split in two. `analyze` needs no library. The 0.55
default is weakly calibrated (n = 2) — treat it as a starting point.

### 2. Enroll a voice

Best: from a cluster you have already identified in an SRT (plenty of audio).

```bash
pi-voiceid enroll --name "Csákány Róbert" --srt talk.srt --label "Speaker 1"
```

From a standalone clip:

```bash
pi-voiceid enroll --name "Kovács Dániel" --audio sample.m4a --start 12 --end 75
```

Re-running the same name **merges** into the existing voiceprint (segment-count
weighted); `--replace` resets it instead. Enroll the same person from several
recordings — the cheapest accuracy win.

### 3. Label a transcript

```bash
pi-voiceid label --srt talk.srt --dry-run
pi-voiceid label --srt talk.srt
```

Always read the dry-run decision table. `--output` overrides the sibling
`*.named.srt` (and is required for the same-file refusal to be reachable).
`--relabel` allows an already-named transcript and leaves clusters whose name is
already in the library untouched, so the iterative workflow (label, enroll one
more person, label again) is safe.

## Reading the output

| Column | Meaning |
|---|---|
| `cos` | centered cosine of the cluster centroid to the best voiceprint |
| `2nd` / `margin` | runner-up and the gap — a small gap means "could be either" |
| `vote` | share of individual segments agreeing with the centroid's pick |
| `space` | whether the cohort mean or the recording fallback produced the score |

Healthy cross-recording match: `cos` 0.6–0.9, `margin` > 0.5, `vote` > 80 %.
Correct rejection of an un-enrolled person looks like `cos` ≈ 0.0–0.25.

## Pitfalls

- **Centering needs a cohort.** Below 40 embeddings the library-wide mean is not
  trusted; the tool falls back to the recording's own mean, raises the threshold
  by one margin minimum, and says so. Enroll ≥ 3 voices.
- **Never center by one speaker's own mean** — the tool refuses a pool with fewer
  than two speakers, or one speaker above 70 % of the pool's audio duration.
- **Channel mismatch is the dominant failure mode.** A voiceprint from a phone
  memo scores poorly against a conference capture. Enroll per capture setup.
- **Model mismatch is refused.** Voiceprints and cohort contributions record the
  model name and dimension; switching models requires re-enrolling.
- Short segments are noise (`--min-seg` defaults to 1.2 s; do not lower it).
- `pi-voiceid` needs the source media beside the SRT (or `--audio`). Media
  shorter than the last cue is refused — never embed ranges that do not exist.

## Limitations

This is approach (A): post-hoc cluster relabeling. It **cannot**:

- separate **overlapping speech** (two people at once);
- fix a cluster that already merges two speakers (check `analyze` coherence —
  below ~0.55 the cluster itself is impure);
- recover a speaker the diarizer never separated at all.

Those need approach (B), true **TS-VAD / personal VAD**, where the enrollment
embedding feeds a frame-level model. Requires training; out of scope.

Accuracy on real audio is a **lower bound**: it was measured against another
diarizer's labels, not human annotation. Do not quote the segment-level figure
as the product's accuracy.

## Verification

```bash
pi-voiceid label --srt "<enrollment source>.srt" --dry-run   # expect a 1:1 map, high cos
pi-voiceid label --srt "<unrelated recording>.srt" --dry-run # expect mostly UNKNOWN
pi-voiceid list                                              # enrolled voices must not resemble each other
```

Measured on the reference archive: self-consistency 3/3 at cos 0.89–0.99 with a
4th un-enrolled cluster rejected at 0.252; cross-recording matches at cos
0.72–0.89. Full numbers and the six-model comparison are in
[BENCHMARK.md](BENCHMARK.md).
