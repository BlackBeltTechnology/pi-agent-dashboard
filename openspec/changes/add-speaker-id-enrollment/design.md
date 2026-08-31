# Design — speaker-id enrollment

## Approach

Post-hoc cluster relabeling, not a new diarizer:

```
existing SRT (anonymous clusters)
        │
        ├─ sample segments ACROSS the timeline, per cluster
        ├─ embed each with a speaker-embedding ONNX model (CPU)
        ├─ centre (subtract a multi-speaker mean), average → cluster centroid
        │
        └─ cosine against the voiceprint library
                 ├─ passes all three gates → assign the name
                 └─ otherwise             → keep the anonymous label
```

Several clusters may map to one name. That is not a bug — it is the drift repair.

In the literature this is *speaker enrollment / target-speaker verification*.
The stronger alternative, *TS-VAD* (Medennikov et al., arXiv 2005.07272), feeds
the enrollment embedding into a frame-level model and can handle overlap; it
requires training and is out of scope.

## Four measured findings that constrain the design

All measured on 2026-08-31, CPU, against real Hungarian meeting recordings.
Full protocol and tables in `reference/BENCHMARK.md`.

### 1. Model size and VoxCeleb rank are actively misleading

| Model | Size | Centered accuracy |
|---|---:|---:|
| wespeaker resnet293_LM (VoxCeleb leader) | 114 MB | **50.0 %** |
| 3dspeaker campplus_sv_**en_voxceleb** | 30 MB | 54.0 % |
| wespeaker resnet34_LM | 26 MB | 60.0 % |
| 3dspeaker campplus_sv_**zh_en** advanced | **28 MB** | **70.5 %** |
| 3dspeaker eres2netv2 zh-cn common | 71 MB | 71.0 % |
| nemo titanet_large | 101 MB | 72.0 % |

The clean split is **training-set breadth**, not parameter count: every
multilingual / 200k-speaker model landed at 70–72 %, every English-VoxCeleb-only
model at 50–60 %. The largest model was the worst.

**Decision:** default to `3dspeaker_campplus_sv_zh_en_16k-common_advanced` — its
70.5 % is within the noise of the 72.0 % leader at this sample size (so treat
them as indistinguishable, **not** as a proven tie), it was 4/4 at cluster
level, 5× faster than eres2netv2 and 3.5× smaller than titanet_large. Note the
winner is a zh/en model evaluated on **Hungarian** audio — that is the finding,
not an oversight: breadth of training pool beat language overlap. Do not "upgrade" without
re-running the benchmark.

### 2. Raw cosine saturates; centering is what makes a threshold possible

On single-channel meeting audio the global mean embedding had norm **0.765** —
most of every embedding is one shared channel/session direction.

| | raw | centered |
|---|---:|---:|
| two *distinct* speakers | 0.903 – 0.99 | −0.47 … 0.26 |
| median decision margin | 0.009 | 0.125 |
| separation of 3 enrolled voices | ≈ 0.95 | 0.05 / −0.46 / −0.61 |

Centering barely moves *accuracy* — the transform is near-monotonic, so ranking
is largely preserved. Its value is getting scores off the saturation ceiling so
that a **fixed threshold** exists at all. Without it, no usable threshold does.

**Decision:** subtract a mean, then re-normalise, on **both sides** of every
comparison.

### 3. The centering mean must come from a multi-speaker pool

Centering a speaker by their *own* mean cancels exactly the signal being
measured. And using two *different* means on the two sides of a cross-recording
comparison is not sound — they must share one space.

**Decision:** the library keeps a **cohort mean**: a running sum over embeddings
from *every* speaker of *every* enrolled recording. `enroll` therefore also
embeds the other clusters of the source SRT purely to feed the cohort. Below a
minimum cohort size (reference uses 40) the mean is not trusted and the tool
falls back to the mean of the recording being labeled, printing a note.

### 3a. One centering space, applied at compare time — never at rest

The cohort mean moves on every enrollment. If voiceprints were stored *already
centered*, each new enrollment would silently invalidate every older vector —
reintroducing exactly the "two different means on the two sides" error finding 3
rules out.

**Decision:** stored voiceprint vectors are **raw** (L2-normalised, uncentered).
Centering is applied to both sides **at comparison time** with the mean current
for that run. No stored vector is ever rewritten when the cohort grows.
Consequence: a score is only meaningful relative to the run that produced it —
`label` and `list` therefore print which mean was used (cohort vs recording).

The cohort is **not** one aggregate sum. It is a list of per-recording,
per-speaker **contributions** (`{ recordingId, speakerKey, sum, count }`); the
mean is derived by summing them on load. A single aggregate would make erasure
inexact — float addition is not associative, so `(s₁+s₂+s₃) − s₂` is not `s₁+s₃`,
and the drift compounds over repeated forgets. Storing contributions separately
makes erasure a **deletion**, exact by construction, and lets `forget <name>`
remove that person's own embeddings from the pool rather than only their
voiceprint.

**Recording identity** is the SHA-256 of the media file's first and last 1 MiB
plus its byte length — not its path. A re-transcribed or renamed copy of the
same audio must not contribute twice; "exactly once" is meaningless if the key
is a filename.

A recording contributes **exactly once**; re-enrolling a person from an
already-seen recording merges their voiceprint but adds no contribution.

**Known limitation — the mean is not stationary.** A person enrolled from many
*different* recordings does pull the cohort mean toward themselves, which
slightly lowers their own centered score. `list` prints the cohort composition
so a lopsided pool is visible. Bounded, not eliminated; if it bites,
`forget --recording` is the lever.

**Threshold calibration is bound to the cohort space.** The gate defaults below
were measured with a trusted cohort mean. On the small-cohort fallback the score
distribution differs, so the same numbers are *uncalibrated* there. A printed
warning changes no decision, and "below threshold" is not meaningful in a space
the threshold was never measured in — so on the fallback path the absolute
threshold is **raised by the margin minimum** and the run is marked
low-confidence. `--force-fallback-thresholds` restores the calibrated numbers
for a user who knows their pool. Never rename on numbers that mean nothing.

**The raises do not stack.** Two conditions can each ask for `+ margin` (a
single enrolled voiceprint; a small-cohort fallback) and on the very first run
*both* hold. The absolute threshold is raised by **at most one** margin minimum
— 0.45, never 0.55. `--force-fallback-thresholds` cancels the fallback reason
only; if the single-voiceprint reason still applies, the raise stays. The report
names which reason is active.

**Pool degeneracy is a property of the pool, not of the path.** A centering mean
is usable only when its pool holds ≥ 2 speakers and no single speaker exceeds
70 % of the pool's **audio duration** (not of sampled segments — the sampler
caps segments per cluster, so a 95/5 interview would sample ~50/50 and the guard
would never fire on the shape it exists to catch). This test applies to the
cohort mean and the recording-fallback mean **alike**: a 40-embedding cohort
built from one recording dominated by one speaker is the same forbidden
transform, admitted through the path labelled safe. When the pool fails the
test, report that centering is not possible and rename nothing.

### 3b. Two things this design asserts but has NOT measured

Surfaced by adversarial review; recorded here rather than quietly assumed.

**The centering mean cannot remove the *target* recording's channel.** Finding 2
justifies a fixed threshold by subtracting "one shared channel/session
direction", but the cohort mean is built only from *enrolled* recordings.
Labeling an unseen recording B subtracts the enrolled recordings' channel
direction from B's vectors and leaves B's own intact — the very component
centering was supposed to remove. Cross-video matching nonetheless worked in the
reference run (cos 0.72 / 0.89), so the mechanism is not dead; the *explanation*
is simply stronger than the evidence. Treat centering as "empirically gets
scores off the ceiling", not as "removes the channel".

**The cohort space and the fallback space have never been compared.** The
reference end-to-end run enrolled three speakers from **one** recording and
labeled **that same** recording — so its "cohort mean" *was* that recording's
mean. The two spaces this design separates were numerically identical in the
only measurement that exists, which means the `+ margin` fallback penalty rests
on zero data and fires only on new users. Task 7.7 measures the distributions
before the penalty is trusted; until it reports, the penalty is a conservative
guess and must be described as one.

### 4. The available ground truth is noisy — report honestly

Accuracy was measured against another diarizer's labels, not human annotation.
Soniox cues cut mid-word, so labels near cue boundaries are unreliable. The
~70 % figures are a **lower bound** and are only trustworthy as a *relative*
ranking between models. The tool assigns **whole clusters**, where the best
models scored 4/4.

Do not quote the segment-level number as the product's accuracy in user-facing
docs without this caveat.

## Module layout

Mirrors the package's existing shape: small pure modules, injectable
dependencies, vitest beside them.

| File | Responsibility | Testable without native dep? |
|---|---|---|
| `src/voiceprint.ts` | Library JSON: load/save, merge-on-re-enroll, cohort accumulation, `centre()`, cosine | **yes — pure** |
| `src/srt-parse.ts` | Read SRT into cues with `[label]` extracted. (`srt.ts` only *writes*.) | **yes — pure** |
| `src/media-resolve.ts` | SRT → source media path; explicit `--audio` override | **yes — pure** |
| `src/audio-decode.ts` | Cue time-range → 16 kHz mono float32 windows via ffmpeg, streamed | **yes — ffmpeg runner injected** |
| `src/speakerid.ts` | Segment sampling, cluster profiling, the three decision gates, drift detection | **yes — embedder injected** |
| `src/embedding.ts` | `sherpa-onnx-node` wrapper; lazy import; actionable error when absent | no — thin by design |
| `src/models.ts` | Model resolution + on-demand download, checksum, cache dir | partly |
| `src/bin/voiceid.ts` | CLI wiring only | via `run`-style deps |

Keep the native binding confined to `embedding.ts`. Everything with logic worth
testing must be reachable with a fake embedder — which is why decode is its own
module rather than a detail of `embedding.ts`: mapping cue time ranges to strided
PCM windows without buffering 90 minutes is off-by-one-prone logic, and burying
it behind the one untestable module would put the most error-prone code out of
reach of the test suite. Note the ~12 s profiling budget measures embedding
**only**; decode is additional and must be measured separately.

## Decision gates

A cluster is renamed only when **all three** hold; otherwise the anonymous label
is kept. Never guess a name.

| Gate | Reference default | Why |
|---|---:|---|
| `cos ≥ threshold` | 0.35 | absolute confidence |
| `margin ≥ min` | 0.10 | gap to the runner-up — guards against two similar voices |
| `vote ≥ min` | 0.45 | share of individual segments agreeing with the centroid's pick — guards against an impure cluster |
| `segments ≥ min` | 3 | a cluster sampled to 1–2 segments votes 1.0 by construction — without a floor the vote gate is decorative on exactly the short clusters drift produces |

With **one** voiceprint enrolled there is no runner-up, so the margin gate is
**not evaluated** — and the vote gate is vacuous too (argmax over a single
candidate agrees with itself on every segment, so vote is always 1.0). Both
discriminate *between* candidates; neither can bound a false accept when there
is nothing to compare against. The compensation is one raised absolute
threshold, `threshold + margin` (0.45) — a **heuristic, not an equivalent gate**.
Say so in the report rather than implying three gates ran.

Segment sampling is **deterministic** (fixed stride over the cluster's timeline,
no RNG). A stochastic sample would make the vote share flip between runs on the
same input, which is not acceptable for a gate.

`analyze` uses a separate **drift threshold, default 0.55** on centered cosine
between two cluster centroids of the same recording, exposed as
`--drift-threshold`. It sits midway between the only two observations available
(a same-speaker split at 0.83, the highest distinct-speaker pair at 0.26) —
n = 2, so treat it as a starting point, not a calibrated constant, and label it
that way in the output. `analyze` runs without a library, so it is a
fallback-geometry run by construction and is subject to the same degenerate-pool
refusal above. It is **not** subject to the `+ margin` raise: that raise
compensates a *naming* decision made in an uncalibrated space, and `analyze`
names nobody — it reports a similarity for a human to judge. Its threshold is
advisory by construction, which is why it is exposed as a flag.

Measured behaviour: correct matches land at cos 0.72–0.99 with margins > 0.5 and
votes > 80 %; a genuinely un-enrolled speaker scored 0.252 and was correctly
rejected. Rejection working is what stops the tool inventing names.

## Storage

- **Voiceprint library** — default `~/.pi/voiceprints/voiceprints.json`,
  overridable (env var + CLI flag). Must be overridable so tests never touch
  `$HOME`. This is biometric-derived data: document it, never commit it, and add
  the path to `.gitignore` if it can land inside the repo.
- **Models** — a cache dir outside the package (e.g. `~/.pi/models/speaker/`).
  28 MB must not be vendored into npm.
- **Output** — sibling `*.named.srt` by default, overridable with `--output`.
  The source SRT is never modified; refuse explicitly when input and output
  resolve to the same file. Compare `(device, inode)` via `stat`, not resolved
  path strings: a hard link to the source has a different `realpath` but the
  same inode, and a case-insensitive filesystem (macOS, Windows) resolves a
  case-only alias differently while writing the same file. Without the
  `--output` flag that refusal is unreachable dead code — the flag is what makes
  the guard real.
- **Writes are atomic *and* serialized.** Atomic replace alone is not enough:
  `rename` prevents a torn file, but two processes that each read-then-write
  still lose one enrollment (last writer wins). Every mutation therefore takes
  an exclusive lock — `open(<store>.lock, 'wx')`, stale-lock broken by age — and
  performs read → mutate → write **inside** it, to a **uniquely named** temp
  sibling (pid + random suffix, so two writers cannot clobber one another's
  temp) that is then `rename`d into place. **Profiling happens outside the
  lock.** The critical section holds only the JSON read-modify-write —
  milliseconds — so no hold ever approaches the staleness age. Holding the lock
  across a 90-minute enrollment would let a peer judge it stale and steal it
  mid-flight, reintroducing the lost update the lock exists to prevent.
- **Contributions carry `model` + `dim` too**, not just voiceprints. Enforcing
  model identity only per-voiceprint leaves orphan sums: forget every model-X
  voiceprint, enroll under model Y, and no voiceprint triggers the refusal while
  model-X vectors silently poison the mean. A mixed-model cohort is refused, not
  reset — a silent reset (what the reference does) discards data the user never
  agreed to discard.
- **Contributions are summed in a stable, explicitly sorted order**
  (`recordingId`, then `speakerKey`). Float addition is not commutative-safe
  across orderings, so bit-identical erasure requires a defined order; deriving
  the mean from a `Map` iteration or a re-sorted JSON round-trip would break the
  exactness the contribution list exists to provide.
- **`forget --recording` also drops the recording from the contributed set**, so
  a later enroll from that media contributes again. "Exactly once" is a
  deduplication rule, not a tombstone — otherwise erasing a recording would
  permanently poison it.
- **Input** — `label`/`analyze` take an SRT but need the *audio*. Resolution
  order: explicit `--audio`, then the sibling media file the SRT was produced
  from (same basename, known media extensions in a fixed precedence order —
  `.mkv`, `.mp4`, `.mov`, `.m4a`, `.mp3` — mirroring `src/discover.ts`, which is
  the set this package actually produces transcripts from; a list invented here
  would strand `.mov` inputs on "media missing"). Media missing → fail naming
  every path tried. **Presence is not enough:** refuse when the media is
  **shorter** than the transcript's last cue end (beyond a small tolerance) — a
  trimmed or unrelated sibling would be embedded at time ranges that do not
  exist and produce confident, wrong names, the worst failure this tool can
  have. The check is deliberately **one-sided**: media *longer* than the last
  cue is the normal case (a recording whose final minutes are silence) and must
  not be refused. `ffprobe` is an optional tool in this package and
  `ffmpeg.ts` returns `0` on a parse failure, so an unavailable or unparseable
  duration **skips** the check with a printed note rather than treating `0` as
  an infinite mismatch.
- **Already-labeled input** — "anonymous" is defined **positively**: a label
  matching `Speaker <n>` or a bare `<n>`. Anything else (a personal name, but
  equally a role like `Interviewer`) counts as already-labeled and is **refused**
  unless `--relabel` is passed. Defining it the other way round — guessing which
  strings look like names — is unbounded and misclassifies role labels either
  way. Non-speaker brackets (`[music]`, `[inaudible]`) are **not labels at all**:
  the parser emits those cues as *unlabeled*, so they never form a cluster and
  never trip the already-labeled refusal. Without that carve-out a single
  `[music]` cue would refuse an otherwise anonymous transcript, and `--relabel`
  would offer `music` as a nameable cluster.
- **`--relabel` semantics** — named labels are treated as clusters keyed by their
  existing name, and a cluster whose existing name is already in the library is
  **left untouched** rather than re-derived. This makes the iterative workflow
  (label, enroll one more person, label again) safe: previously assigned names
  survive, and only still-anonymous clusters are decided.
- **Label format** — this package renders `[Speaker N]` (`srt.ts`); older transcripts
  from the standalone tool use bare `[N]`. The parser accepts both. A leading
  bracket that is not a speaker tag (`[music]`, `[inaudible]`) must not be
  mistaken for one.

Voiceprints are bound to the model that produced them: store `dim` and model
name, and **fail loudly** on mismatch rather than comparing across models.

## Risks

| Risk | Mitigation |
|---|---|
| Native binary missing on a platform | optional dependency; feature-detect; clear error; existing transcription unaffected |
| Channel mismatch (phone memo vs conference capture) — the dominant error source | document "enroll per capture setup"; surface the score so the user can judge |
| Cohort too small early on → weak centering | explicit fallback + printed note; `list` shows cohort state |
| Model swapped, library silently invalid | dim/model recorded per voiceprint; refuse with a re-enroll instruction |
| Biometric data at rest | explicit, overridable location; documented; not committed |
| **Cohort retains embeddings of people who were never enrolled** — `enroll` embeds the source recording's *other* clusters on purpose (finding 3), so third parties end up in the store | `forget <name>` removes the voiceprint **and the cohort contributions recorded against that name**. Be honest about the limit: a contribution is keyed `(recordingId, clusterTag)`, and a name is bound to a cluster only where that person was the enrolled subject. A third party who was merely swept into the pool has no name in the library, so `forget <name>` cannot reach them — `forget --recording <id>` is the only instrument that does, and it drops that recording's speakers wholesale. `list` shows the cohort's recordings and which clusters carry a name, so what is *not* erasable by name is visible. |
| Model identity is recorded as **name + dim** — a pragmatic proxy, not embedding-space identity | a silent retrain published under the same name would pass. Accepted: fingerprinting weights costs more than it saves here. A mixed-model library is refused outright rather than silently narrowing the candidate set, since dropping candidates would change the margin and vote gates without saying so. |
