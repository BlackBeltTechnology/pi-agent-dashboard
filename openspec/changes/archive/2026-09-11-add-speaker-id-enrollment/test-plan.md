# Test Plan — add-speaker-id-enrollment

Stage: design   Generated: 2026-09-01

Levels for this change (no dashboard UI surface, so no L3 Playwright rows):

- **L1** — `packages/video-transcription/src/**/__tests__/*.test.ts` (vitest),
  pure logic with an injected fake embedder / fake ffmpeg runner.
- **L2** — `qa/tests/*.sh` \| `*.ps1`, process/install/multi-OS runtime.
- **manual-only** — accuracy on real recordings; the observable is a human
  judgment against noisy ground truth, deferred post-merge.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Gates: absolute threshold | BVA | L1 | automated | fake embedder yields cos 0.349 / 0.350 / 0.351 vs one voiceprint, cohort trusted | `label` runs | 0.349 keeps the anonymous label with reason `below-threshold`; 0.350 and 0.351 rename |
| E2 | Gates: margin | BVA | L1 | automated | two voiceprints, best 0.80, runner-up 0.71 / 0.70 / 0.69 | `label` runs | margins 0.09 rejects with reason `ambiguous`; 0.10 and 0.11 rename |
| E3 | Gates: vote | BVA | L1 | automated | 10 sampled segments, 4 / 5 agreeing with the centroid pick | `label` runs | 0.40 rejects with reason `weak-vote`; 0.50 renames |
| E4 | Gates: minimum segments | BVA | L1 | automated | clusters yielding 2 / 3 sampled segments, both cos 0.99 | `label` runs | 2 segments rejects with reason `insufficient-segments`; 3 renames |
| E5 | Single voiceprint leaves no runner-up | decision-table | L1 | automated | exactly one voiceprint, cluster scores 0.40 then 0.46, cohort trusted | `label` runs | 0.40 rejected (raised threshold 0.45), 0.46 renamed; report states margin+vote not evaluated |
| E6 | Threshold raises do not stack | decision-table | L1 | automated | one voiceprint AND cohort of 12 (< 40), cluster scores 0.50 | `label` runs | renamed — effective threshold is 0.45, not 0.55; report names both active reasons |
| E7 | `--force-fallback-thresholds` cancels only the fallback reason | decision-table | L1 | automated | one voiceprint, cohort 12, cluster 0.40, flag set | `label` runs | still rejected: the single-voiceprint raise survives the flag |
| E8 | Cohort minimum | BVA | L1 | automated | cohort of 39 / 40 embeddings across 3 speakers | `label` runs | 39 reports fallback mean; 40 reports cohort mean |
| E9 | Pool dominance guard | BVA | L1 | automated | pool where one speaker holds 69 % / 71 % of audio duration | centering mean requested | 69 % proceeds; 71 % reports `cannot-compensate` and renames nothing |
| E10 | Dominance guard reads duration, not sampled segments | EP | L1 | automated | 95/5 duration split, per-cluster sample cap equalising to ~50/50 segments | centering mean requested | guard fires on the 95 % speaker — asserts the guard did not read the sampled counts |
| E11 | Pool dominance applies to the cohort too | EP | L1 | automated | cohort ≥ 40 embeddings but 90 % one speaker | `label` runs | rejected as a centering pool on the same terms as a recording pool |
| E12 | Fewer than two speakers in the pool | EP | L1 | automated | single-cluster recording, no cohort | `label` runs | reports it cannot compensate; never centers on that speaker's own mean |
| E13 | Merge-on-re-enroll is segment-count weighted | EP | L1 | automated | voiceprint of 10 segments, re-enrolled from 30 segments | `enroll` runs | stored vector equals the 10:30 weighted mean; sources list holds both recordings |
| E14 | Replace discards the previous vector | decision-table | L1 | automated | existing voiceprint, `--replace` | `enroll` runs | previous vector gone, sources reset to the new recording alone |
| E15 | Cohort contributes exactly once | EP | L1 | automated | recording R already contributed; enroll a second speaker from R | `enroll` runs | voiceprint added, cohort sum and count unchanged |
| E16 | Recording identity is content-derived | EP | L1 | automated | same media bytes at two paths / under two names | `enroll` runs twice | second run does not contribute; ids equal |
| E17 | A forgotten recording may contribute again | state-transition | L1 | automated | `forget --recording R`, then enroll from R | `enroll` runs | cohort grows — "exactly once" is dedup, not a tombstone |
| E18 | Erasure is exact | EP | L1 | automated | library built from contributions A,B,C; forget B | `forget` runs | derived mean is bit-identical to a library built from A,C only |
| E19 | Erasure is order-independent | EP | L1 | automated | same contributions stored in shuffled order | mean derived | bit-identical mean across orderings |
| E20 | Forget by name removes that speaker's contributions | EP | L1 | automated | recording with enrolled Alice + unenrolled co-speaker | `forget Alice` | Alice's voiceprint and her contributions gone; the co-speaker's contribution remains |
| E21 | Unnamed contributions are not erasable by name | EP | L1 | automated | cohort holding a never-enrolled speaker | `list` then `forget <any name>` | `list` shows the contribution as unnamed; it survives every by-name forget |
| E22 | Label form parity | EP | L1 | automated | one SRT with `[Speaker 2]`, one with `[2]` | parse | both yield the same cluster id |
| E23 | Non-speaker brackets are not labels | EP | L1 | automated | SRT with a `[music]` cue among `[Speaker N]` cues | parse then `label` | the cue is unlabeled, forms no cluster, and the transcript is NOT treated as already-labeled |
| E24 | Already-labeled input is refused | decision-table | L1 | automated | SRT labeled `[Alice]`; separately `[Interviewer]` | `label` without `--relabel` | both refused; `--relabel` proceeds |
| E25 | Relabel preserves assigned names | state-transition | L1 | automated | `*.named.srt` with `[Alice]` (enrolled) + `[Speaker 3]` | `label --relabel` | Alice's cues untouched; only cluster 3 is decided |
| E26 | Millisecond separator + BOM | EP | L1 | automated | SRT variants using `,` and `.`, with and without a BOM | parse | identical cue sets |
| E27 | Parse round-trip | EP | L1 | automated | arbitrary SRT fixture | parse then re-render | timestamps and text byte-identical |
| E28 | Media extension precedence | decision-table | L1 | automated | dir holding `talk.mp4`, `talk.m4a`, `talk.mp3` beside `talk.srt` | media resolution | `.mp4` wins per the fixed order, independent of readdir order |
| E29 | Explicit audio overrides discovery | EP | L1 | automated | `--audio other.wav` with a sibling present | media resolution | `other.wav` used |
| E30 | Sampling spans the timeline | EP | L1 | automated | cluster with cues across 0–90 min | segment sampling | picks span the full range, not a leading prefix |
| E31 | Sampling is deterministic | EP | L1 | automated | one cluster fixture | sample twice | identical segments and identical vote share |
| E32 | All-short-cluster fallback | EP | L1 | automated | cluster whose every cue is below the minimum duration | segment sampling | returns the longest available rather than an empty selection |
| E33 | Drift threshold boundary | BVA | L1 | automated | cluster pairs at centered cosine 0.54 / 0.55 / 0.83 | `analyze` runs | 0.54 not flagged; 0.55 and 0.83 flagged as likely one speaker |
| E34 | `analyze` takes no threshold raise | decision-table | L1 | automated | `analyze` with no library (fallback geometry) | `analyze` runs | drift threshold stays 0.55 — no `+ margin` applied |
| E35 | Fewer than two clusters to compare | EP | L1 | automated | SRT with one labeled cluster | `analyze` runs | reports nothing to compare, exit code 0 |
| E36 | Drift merge is reported | EP | L1 | automated | two clusters both matching one voiceprint | `label` runs | both renamed, merge reported |
| E37 | Store path precedence | decision-table | L1 | automated | flag + env var + default all set | any command | flag wins; env used when no flag; `$HOME` default never created when overridden |
| E38 | Malformed store is empty, not fatal | EP | L1 | automated | absent file; invalid JSON | load | both yield an empty library, no throw |
| E39 | Zero-vector guard in centre/cosine | BVA | L1 | automated | zero vector, and a vector equal to the mean | `centre` / cosine | defined result, no NaN |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Native binding absent | fault-injection (abort) | L1 | automated | module resolution of `sherpa-onnx-node` throws | import `embedding.ts` | import succeeds — failure is deferred to first use |
| X2 | Native binding absent, first use | fault-injection (abort) | L1 | automated | same | first embed call | error names the dependency and the install command; never a raw `MODULE_NOT_FOUND` |
| X3 | Transcription unaffected | fault-injection (abort) | L2 | automated | install with optional deps skipped | run `pi-transcribe` | transcription succeeds; `pi-voiceid` fails with the actionable message |
| X4 | Model absent | fault-injection (abort) | L1 | automated | cache dir empty, fetch stubbed to fail | `label` runs | error states the expected path and how to obtain the model |
| X5 | Truncated model download | fault-injection (abort) | L1 | automated | fetch returns a short payload | download | rejected on size/checksum; no partial file left behind |
| X6 | Media missing | fault-injection (abort) | L1 | automated | SRT with no sibling media, no `--audio` | `label` runs | fails naming every path tried; no output written |
| X7 | Media shorter than the transcript | fault-injection (abort) | L1 | automated | media 10 min, last cue ends 40 min | `label` runs | refused — never embeds ranges that do not exist |
| X8 | Trailing silence is not a mismatch | fault-injection | L1 | automated | media 90 min, last cue ends 87 min | `label` runs | proceeds |
| X9 | Duration unknown | fault-injection (abort) | L1 | automated | ffprobe absent / unparseable (`ffmpeg.ts` returns 0) | `label` runs | duration check skipped with a printed note — 0 is not read as an infinite mismatch |
| X10 | Model/dim mismatch on a voiceprint | fault-injection | L1 | automated | stored voiceprint from model X, active model Y | `label` runs | fails naming the affected voiceprints; no SRT written |
| X11 | Same dim, different model | fault-injection | L1 | automated | two 192-dim models with different names | `label` runs | still refused, on the model name |
| X12 | Mixed-model cohort | fault-injection | L1 | automated | contributions carrying model X, active model Y, no model-X voiceprint left | `label` runs | refused; contributions NOT silently reset |
| X13 | Concurrent enrollment | fault-injection (race) | L1 | automated | two processes enrolling different people into one store | both run | both enrollments present afterwards |
| X14 | Interrupted write | fault-injection (abort) | L1 | automated | write throws mid-way | `enroll` runs | store is either the previous or the complete new library; never truncated; no stray temp file |
| X15 | Stale lock | fault-injection (delay) | L1 | automated | lock file older than the staleness age | `enroll` runs | lock broken and acquired; asserts profiling ran outside the critical section |
| X16 | Output collides with input | fault-injection | L1 | automated | `--output` = input path; also a hard link; also a case-only alias | `label` runs | all three refused by device+inode, before any gate evaluation |
| X17 | Collision refusal precedes "nothing renamed" | decision-table | L1 | automated | colliding output AND no qualifying cluster | `label` runs | fails on the output path — does not exit 0 reporting nothing renamed |
| X18 | Dry run writes nothing | fault-injection | L1 | automated | qualifying clusters, `--dry-run` | `label` runs | decision table printed; no file created |
| X19 | No cluster qualifies | EP | L1 | automated | every cluster below threshold | `label` runs | no output file; reports nothing renamed; non-zero exit |
| X20 | Temp cleanup on failure | fault-injection (abort) | L1 | automated | decode throws mid-run | `label` runs | no leftover decoded audio |
| X21 | Digital silence / short window | fault-injection | L1 | automated | window below minimum duration; window of pure silence | embed | both skipped, not embedded |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Profiling budget | threshold | manual-only | manual-only | 90-minute recording, default model, CPU | embedding-only wall time ≈ 12 s | single run, recorded |
| P2 | Decode is measured separately | threshold | manual-only | manual-only | same recording | decode wall time reported as its own number, not folded into P1 | single run |
| P3 | No whole-file buffering | soak | L1 | automated | 90-minute fixture (or a synthetic stream of equal length) | peak RSS stays bounded — asserts streaming, not a full buffer | full decode |

### Accuracy (manual-only — human judgment against noisy ground truth)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Self-consistency | manual | — | manual-only | enroll 3 speakers from recording A | `label` A | 1:1 map at cos 0.89–0.99 |
| M2 | Rejection | manual | — | manual-only | an un-enrolled speaker in A | `label` A | stays anonymous (reference 0.252) |
| M3 | Cross-video | manual | — | manual-only | recording B, same people | `label` B | correct names (reference cos 0.72 / 0.89) |
| M4 | Negative control | manual | — | manual-only | recording of different people | `label` | rejections dominate; any match explained against the transcript |
| M5 | Separation | manual | — | manual-only | 3 enrolled voices | `list` | no pair near the accept threshold (reference 0.05 / −0.46 / −0.61) |
| M6 | Cohort space vs fallback space | manual | — | manual-only | same clusters scored under a multi-recording cohort mean and under the recording's own mean | compare distributions | both tabulated in `reference/BENCHMARK.md`; the `+ margin` penalty is justified or removed (design §3b) |
| M7 | Cross-capture-setup matching | manual | — | manual-only | enrolled from a conference capture, labeled from a phone memo | `label` | scores recorded; if they collapse, the limitation is documented (design §3b) |

### Packaging / runtime (L2)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | Optional dep is optional | state-transition | L2 | automated | clean install with optional deps skipped | install | exits 0; `pi-transcribe` runs |
| S2 | Bin registration | EP | L2 | automated | fresh install | `pi-voiceid --help` | each subcommand's help renders |
| S3 | Prebuilt binaries per platform | decision-table | L2 | automated | each supported platform | install + import | binding loads, or the platform is recorded as degraded in design.md |
| S4 | Package contents | EP | L2 | automated | `npm pack --dry-run` | inspect file list | no ONNX model, no voiceprint data; size near current |

---

## Coverage summary

- Requirements covered: 9/9 (every ADDED requirement has ≥1 falsifying scenario)
- Scenarios by class: edge 39 · error 21 · perf 3 · accuracy 7 · packaging 4
- Scenarios by level: L1 61 · L2 4 · L3 0 · manual-only 9
- Scenarios by disposition: automated 65 · manual-only 9

## New infra needed

- None. L1 uses the package's existing vitest setup; L2 uses `qa/tests/`.
  No Playwright rows — this change adds no dashboard UI surface.
- Note: L2 rows S1/S3 need a clean-install sandbox per OS; `qa/` already
  provides that harness.
