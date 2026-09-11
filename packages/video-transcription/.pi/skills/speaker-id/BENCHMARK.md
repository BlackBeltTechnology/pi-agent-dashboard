# Benchmark — speaker embedding models on Hungarian meeting audio

All numbers measured locally on CPU (macOS, 6 threads), 2026-08-31.

## Setup

- **Test recording:** `~/Movies/2026-08-27 10-34-42.mp3` — 88 min Zenit/RackInspect
  meeting, 4 speakers with balanced speaking time (35 / 33 / 21 / 11 %),
  Hungarian, single mixed channel (OBS screen capture of a video call).
- **Protocol:** held-out temporal split. Segments per Soniox cluster sorted by
  time; first 50 % builds the enrollment centroid, second 50 % is scored.
  100 segments per cluster, min 1.2 s each, capped at 10 s.
- **Ground truth:** the Soniox `[N]` labels. **This is noisy** — Soniox cues cut
  mid-word ("ávozással", "ással sikerült"), so boundary cues carry unreliable
  labels. Treat the accuracies below as a *lower bound* and as a *relative*
  ranking between models, not as absolute quality.

## Results

| Model | Size | dim | Time | Raw acc | Centered acc | Cluster-level |
|---|---:|---:|---:|---:|---:|---:|
| nemo_en_titanet_large | 101 MB | 192 | 31 s | 70.5 % | **72.0 %** | 3/4 |
| 3dspeaker_eres2netv2_sv_zh-cn_16k-common | 71 MB | 192 | 60 s | 72.5 % | 71.0 % | **4/4** |
| **3dspeaker_campplus_sv_zh_en_16k-common_advanced** | **28 MB** | 192 | **12 s** | 74.0 % | 70.5 % | **4/4** |
| wespeaker_en_voxceleb_resnet34_LM | 26 MB | 256 | 19 s | 57.5 % | 60.0 % | 3/4 |
| wespeaker_en_voxceleb_resnet293_LM | 114 MB | 256 | 127 s | 54.5 % | 50.0 % | 2/4 |
| 3dspeaker_campplus_sv_en_voxceleb_16k | 30 MB | 512 | 12 s | 51.0 % | 54.0 % | 3/4 |

## Conclusions

**1. Bigger is NOT better.** `wespeaker_resnet293_LM` (114 MB, the strongest
model on the VoxCeleb leaderboard) scored **worst** here — 50 %, versus 70.5 %
for a 28 MB model. VoxCeleb EER does not transfer to Hungarian meeting audio.

**2. Training-set breadth beats parameter count.** Every model trained on broad
multilingual / 200k-speaker data (campplus zh_en advanced, eres2netv2,
titanet_large) landed at 70–72 %. Every English-VoxCeleb-only model landed at
50–60 %. This is the single largest factor measured.

**3. Default choice: `campplus_sv_zh_en_16k-common_advanced`** — statistically
tied with the best on accuracy, 4/4 at cluster level, but **5× faster than
eres2netv2 and 3.5× smaller than titanet_large**.

**4. Raw cosine saturates; centering is mandatory for interpretation.**
On this single-channel audio the global mean embedding had norm **0.765** — i.e.
most of every embedding is one shared channel/session direction. Consequences:

| | raw cosine | centered |
|---|---:|---:|
| two *distinct* speakers | 0.903 – 0.99 | −0.47 … 0.26 |
| median decision margin | 0.009 | 0.125 |
| enrolled-voice separation | ~0.95 | 0.05 / −0.46 / −0.61 |

Centering barely changes ranking *accuracy* (the transform is near-monotonic),
but it moves scores off the saturation ceiling, which is what makes a **fixed
threshold** possible at all. Without it no usable threshold exists.

The mean must come from a **multi-speaker** pool — centering by a single
speaker's own mean would cancel the signal. `voiceid.py` therefore keeps a
library-wide cohort mean (all speakers of all enrolled recordings) and only
activates centering once the cohort holds ≥ 40 embeddings.

## End-to-end cross-recording test

Enrolled 3 speakers from `2026-08-10 13-03-33` (≈122 s each), then labeled:

| Test | Result |
|---|---|
| **Sanity** — same recording | 3/3 correct at cos **0.89 / 0.96 / 0.99**; a 4th, un-enrolled cluster correctly **rejected** at 0.252 |
| **Positive** — sibling meeting `2026-08-14 14-48-12` | 2 clusters matched across recordings at cos **0.72 / 0.89**; un-enrolled clusters rejected |
| **Negative control** — different project `2026-07-28 14-02-46` | 4/5 rejected (cos −0.08 … 0.13). The 1 match (cos 0.653) is most likely a **true** positive: transcript content shows the same senior participant attends both meetings |

Cross-recording matching therefore works, and — importantly — **rejection
works**, which is what keeps the tool from inventing names.

## Caveats

- Segment-level accuracy of ~70 % is the *inner loop*; the tool assigns whole
  clusters, where accuracy was 4/4. Per-segment numbers are pessimistic.
- The ground truth is another diarizer's output, not human annotation. A proper
  measurement needs a hand-labeled recording; none exists in this archive yet.
- Channel mismatch is the dominant failure mode. Enroll from the same capture
  setup as the target recording whenever possible.
- Overlapping speech is not addressed at all by this approach (that requires
  TS-VAD; see the skill's "Limitations").

## Reproducing

Models live in `~/Documents/.pi/models/speaker/`, downloaded from
`https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models`.
