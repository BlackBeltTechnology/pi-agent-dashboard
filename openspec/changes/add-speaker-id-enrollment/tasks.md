# Tasks — add-speaker-id-enrollment

Test-first throughout: write the failing test named in each `→ verify`, watch it
fail, then implement to green.

Groups 1–3 are pure logic and need **no native dependency and no audio** — they
carry the bulk of the test suite. Do them before touching `sherpa-onnx-node`.

Reference implementation: `reference/voiceid.py`. Where this checklist and the
spec are silent, its behaviour is the spec of record.

## 0. Feasibility gate

- [ ] 0.1 Probe `sherpa-onnx-node@1.13.6` on your platform: install, import, and confirm `SpeakerEmbeddingExtractor` exists. `npm install` exiting 0 proves nothing for a native package. → verify: a one-off script prints the speaker API names
- [ ] 0.2 Compute one embedding through the Node binding and confirm it is 192-dim for the default model. Options are camelCase (`numThreads`); `acceptWaveform` takes `{ sampleRate, samples }`; call `inputFinished()` before `compute()`. → verify: script prints `dim = 192`
- [ ] 0.3 Confirm prebuilt binaries exist for every platform the package claims to support (darwin arm64/x64, linux x64/arm64, win x64). → verify: `npm view sherpa-onnx-node optionalDependencies` lists each
- [ ] 0.4 If any target platform lacks a binary, record the decision here before continuing: optional-dep + graceful degradation, or drop that platform. → verify: decision written into `design.md` risks table

## 1. SRT parsing (`src/srt-parse.ts`)

- [ ] 1.1 Parse an SRT into cues carrying index, start, end, optional `[label]`, and text. `srt.ts` only writes; do not extend it. → verify: test parses a 3-cue fixture with labels
- [ ] 1.2 Handle both `,` and `.` as the millisecond separator, and a leading BOM. → verify: one test per variant
- [ ] 1.3 Treat a cue with no `[label]` prefix as unlabeled rather than failing. → verify: test asserts `label === undefined` and text intact
- [ ] 1.4 Tolerate a missing index line and blank-line noise between blocks. → verify: fixture with both parses to the expected cue count
- [ ] 1.5 Round-trip: parse then re-render preserves timestamps and text exactly. → verify: test asserts byte-equal text and identical timestamps
- [ ] 1.6 Group cues by label into clusters. → verify: test asserts cluster count and per-cluster cue counts
- [ ] 1.7 Accept both label forms: `[Speaker N]` (what `srt.ts` renders) and bare `[N]` (older standalone-tool transcripts). → verify: one test per form asserts the same cluster id
- [ ] 1.8 Do not treat a non-speaker bracket (`[music]`, `[inaudible]`) as a label: emit the cue as unlabeled so it forms no cluster and does not make the transcript count as already-labeled. → verify: test asserts the cue is unlabeled, the text keeps the bracket, and an otherwise-anonymous transcript is still accepted
- [ ] 1.9 Classify a transcript whose labels are personal names (a previously produced `*.named.srt`) as already-labeled. → verify: test distinguishes anonymous from named input

## 2. Voiceprint library (`src/voiceprint.ts`)

- [ ] 2.1 Define the store shape: version, cohort as a **list of contributions** (`recordingId`, `speakerKey`, optional bound `name`, `sum`, `count`, `dim`, `model`), voiceprints keyed by name with vector, dim, model, segment count, coherence, sources. → verify: round-trip test writes and re-reads every field
- [ ] 2.2 Treat a missing or malformed store file as empty rather than throwing. → verify: tests for absent file and invalid JSON both yield an empty library
- [ ] 2.3 Implement L2 normalisation, cosine, and `centre(vector, mean)` returning a re-normalised vector; `centre` with no mean is plain normalisation. → verify: unit tests incl. a zero-vector guard
- [ ] 2.4 Derive the cohort mean by summing contributions in a defined stable order (`recordingId`, then `speakerKey`) — not from a running aggregate, and not in `Map` iteration order. → verify: test asserts the mean of three known contributions, and that shuffling storage order yields a bit-identical mean
- [ ] 2.5 Refuse — do not silently reset — when an incoming vector's model or dimension differs from a stored contribution's. Contributions carry `model`+`dim` for this reason; a reset discards data the user never agreed to discard. → verify: test asserts refusal and that stored contributions survive
- [ ] 2.6 Expose the cohort mean only at or above the minimum size, otherwise signal unavailable. → verify: two tests either side of the boundary
- [ ] 2.7 Implement merge-on-re-enroll as a segment-count-weighted average, appending the source. → verify: test asserts the merged vector and the accumulated source list
- [ ] 2.8 Implement replace semantics discarding the previous vector. → verify: test asserts the old vector is gone and sources reset
- [ ] 2.9 Detect dim/model mismatch between a stored voiceprint and the active model. → verify: test returns the offending names
- [ ] 2.10 Resolve the store path from flag, then env var, then default; never touch `$HOME` when overridden. → verify: test with a temp dir asserts no write under `$HOME`
- [ ] 2.11 Store voiceprint vectors **raw** (L2-normalised, uncentered); apply centering only at comparison time. A later enrollment must never rewrite a stored vector. → verify: test enrolls B after A, asserts A's stored bytes unchanged and A still matches
- [ ] 2.12 Key the cohort by source recording id; a recording contributes exactly once even when re-enrolled from. → verify: test re-enrolls from a seen recording and asserts cohort sum and count unchanged
- [ ] 2.13 Serialize mutations behind an exclusive lock (`open(<store>.lock, 'wx')`, stale-lock broken by age) and write via a uniquely named temp sibling + `rename`. Atomic replace alone still loses one of two concurrent enrollments. → verify: test runs two concurrent enrollments and asserts both survive; second test asserts no truncated store after a mid-write throw
- [ ] 2.14 Implement `forget`: by name (dropping the voiceprint **and** that speaker's cohort contributions) and by recording id (dropping the whole recording). → verify: tests assert the derived mean equals the mean of the remaining contributions exactly, and that co-speakers survive a by-name forget
- [ ] 2.15 Refuse a model-name mismatch even when the dimension matches. → verify: test with equal dims and different model names returns the offending names
- [ ] 2.16 Erase by deleting contributions, never by subtracting from an aggregate — float subtraction is not exact. → verify: test forgets a middle contribution and asserts bit-equality with a library built without it
- [ ] 2.17 Derive the recording id from media content (SHA-256 of first + last 1 MiB plus byte length), not from the path. → verify: test asserts a renamed copy yields the same id and does not contribute twice
- [ ] 2.18 `forget --recording` also clears the recording from the contributed set, so later enrollment from that media contributes again. → verify: test forgets then re-enrolls and asserts the cohort grows

## 3. Matching logic (`src/speakerid.ts`)

- [ ] 3.1 Sample segments spread **across the timeline**, not the longest first — drift is temporal and longest-first hides it. Honour minimum duration, maximum count, and a total-seconds cap. → verify: test asserts picks span the full range, not a prefix
- [ ] 3.2 Fall back to the longest available segments when none meet the minimum duration. → verify: test with all-short cues returns a non-empty selection
- [ ] 3.3 Profile a cluster into a centroid via an **injected** embedder. → verify: test with a fake embedder asserts the centroid, no native dep loaded
- [ ] 3.4 Compute the recording-level multi-speaker mean, and return unavailable when fewer than two clusters exist. → verify: two tests
- [ ] 3.5 Implement the three gates (threshold, margin, vote) returning a decision plus a machine-readable reason. → verify: one test per outcome — assigned, below-threshold, ambiguous, weak-vote
- [ ] 3.6 Compute the per-segment vote share against the full voiceprint set. → verify: test with a deliberately split cluster asserts the fraction
- [ ] 3.7 Report drift: cluster-pair similarities above a threshold, plus per-cluster coherence. → verify: test asserts the flagged pair from a crafted fixture
- [ ] 3.8 Map several clusters onto one name and report the merge. → verify: test asserts both clusters resolve to the name and a merge is reported
- [ ] 3.9 Prefer the cohort mean, fall back to the recording mean, and signal which was used. → verify: two tests asserting the reported source
- [ ] 3.10 Enforce a minimum sampled-segment count (default 3) before the vote gate can pass; below it, reject with an insufficient-segments reason. → verify: test with a 2-segment cluster asserts rejection, not a 1.0 vote
- [ ] 3.11 With exactly one voiceprint enrolled, raise the absolute threshold by the margin minimum and report that the margin and vote gates were not evaluated (both are vacuous with a single candidate). → verify: test asserts a score between the two thresholds is rejected and the report names the un-evaluated gates
- [ ] 3.12 Set the `analyze` drift threshold default to 0.55 centered cosine. → verify: test asserts the 0.83 reference pair flags and a 0.26 pair does not
- [ ] 3.13 On the small-cohort fallback, raise the absolute threshold by the margin minimum unless `--force-fallback-thresholds` is given — the calibrated numbers were not measured in that space. → verify: two tests, one per flag state
- [ ] 3.14 Refuse any centering pool — **cohort or recording-fallback alike** — with fewer than 2 speakers, or where one speaker exceeds 70 % of the pool's **audio duration**. Measure duration, not sampled segments: the per-cluster sample cap equalises clusters, so a 95/5 interview would sample ~50/50 and the guard would never fire. → verify: tests for a dominated cohort and a dominated recording both assert nothing is renamed
- [ ] 3.15 Make segment sampling deterministic (fixed stride, no RNG). → verify: test asserts two runs over one fixture pick identical segments
- [ ] 3.16 Cap the absolute-threshold raise at one margin minimum when both the single-voiceprint and small-cohort reasons apply; report the active reasons. → verify: test asserts 0.45, not 0.55, on a first-enrollment run

## 4. Embedding runtime (`src/embedding.ts`)

- [ ] 4.1 Wrap `sherpa-onnx-node` behind the narrow interface `speakerid.ts` consumes. → verify: interface satisfied by the test fake
- [ ] 4.2 Import lazily so importing the module never throws when the binding is absent. → verify: test stubs resolution failure and asserts import succeeds
- [ ] 4.3 Fail on first use with a message naming the dependency and install command. → verify: test asserts the message, not a raw MODULE_NOT_FOUND
- [ ] 4.4 Decode audio to 16 kHz mono float32 in its own module `src/audio-decode.ts` (ffmpeg runner injected, so the cue-range → PCM-window mapping is testable without the native embedder); stream rather than buffering a 90-minute file. → verify: integration test on a short fixture asserts sample rate and channel count
- [ ] 4.5 Skip windows shorter than the minimum or containing digital silence. → verify: tests for both
- [ ] 4.6 Clean up temporary decoded audio on both success and failure. → verify: test asserts no leftover temp file after a thrown error
- [ ] 4.7 Add `sherpa-onnx-node` to `optionalDependencies`, not `dependencies`. → verify: `package.json` inspected; a fresh install with the optional dep skipped still runs `pi-transcribe`
- [ ] 4.8 Resolve an SRT's source media (`src/media-resolve.ts`): explicit `--audio` first, then sibling media by fixed extension precedence (`.wav`, `.m4a`, `.mp3`, `.mkv`, `.mp4`) — never readdir order; fail naming every path tried. → verify: tests for override, multi-candidate precedence, and the missing-media error
- [ ] 4.9 Refuse when the resolved media is **shorter** than the last cue's end beyond tolerance; longer is normal (trailing silence) and must pass. When `ffprobe` is absent or its output unparseable (`ffmpeg.ts` returns `0`), skip the check with a note rather than reading `0` as an infinite mismatch. → verify: three tests — truncated refuses, longer passes, unprobeable skips

## 5. Model management (`src/models.ts`)

- [ ] 5.1 Default to `3dspeaker_campplus_sv_zh_en_16k-common_advanced`. Do **not** substitute a larger model — see `reference/BENCHMARK.md`, where the 114 MB model scored worst. → verify: test asserts the default name
- [ ] 5.2 Resolve from an explicit path, then the cache dir, then download on demand. → verify: tests for each branch with a stubbed fetch
- [ ] 5.3 Verify the download by size or checksum and refuse a truncated file. → verify: test with a short payload fails and leaves no partial file in place
- [ ] 5.4 Never vendor the model into the npm package. → verify: `package.json` `files` excludes it; `npm pack --dry-run` stays near current size

## 6. CLI (`src/bin/voiceid.ts`)

- [ ] 6.1 Add the `pi-voiceid` bin with `enroll`, `list`, `analyze`, `label`. → verify: `--help` smoke test per subcommand
- [ ] 6.2 Structure it like `run.ts` with injectable deps so it is testable without real I/O. → verify: smoke test drives it with fakes
- [ ] 6.3 `enroll` accepts either a clip with start/end or an SRT plus a label. → verify: one test per mode
- [ ] 6.4 `enroll` also embeds the source SRT's **other** clusters to feed the cohort — the mean must stay multi-speaker. → verify: test asserts the cohort grew by more than the enrolled cluster's segments
- [ ] 6.5 Warn on too little enrollment audio or low coherence, without failing. → verify: tests assert both warnings
- [ ] 6.6 `list` prints the library plus a cross-similarity matrix and the cohort state. → verify: snapshot test
- [ ] 6.7 `analyze` works with an empty library. → verify: test runs with no store present
- [ ] 6.8 `label` prints the decision table (cos, runner-up, margin, vote, decision) before writing. → verify: snapshot test
- [ ] 6.9 `label` writes a sibling `*.named.srt`, preserving unmatched labels. → verify: test asserts renamed and preserved cues in one output
- [ ] 6.10 Refuse when output and input are the same file, compared by `(device, inode)` — a hard link or a case-only alias defeats a path comparison. → verify: tests for a hard link and a case-only alias on a case-insensitive filesystem → verify: test asserts failure and an untouched input
- [ ] 6.11 `--dry-run` prints and writes nothing. → verify: test asserts no file created
- [ ] 6.12 Exit non-zero when no cluster qualifies. → verify: test asserts the exit code
- [ ] 6.13 Add `--output` so the sibling default can be overridden — without it the same-path refusal in 6.10 is unreachable. → verify: test writes to an explicit path
- [ ] 6.14 Add a `forget` subcommand for a name and for a recording id. → verify: `--help` lists it; test drives both modes
- [ ] 6.15 Define "anonymous" positively (`Speaker <n>` or bare `<n>`); refuse any other label — personal names and role labels alike — unless `--relabel` is passed. → verify: tests for a name, a role label (`Interviewer`), and `--relabel` proceeding
- [ ] 6.16 Report which centering space produced each score (cohort vs recording fallback) in `label` and `list`. → verify: snapshot shows the space per run
- [ ] 6.17 Expose `--drift-threshold` for `analyze` and label the 0.55 default as weakly calibrated (n = 2) in the output. `analyze` does not take the `+ margin` raise — it names nobody. → verify: test overrides it; snapshot shows the caveat
- [ ] 6.18 Validate the output path (including the same-file check) **before** gate evaluation, so an output collision fails rather than exiting 0 with "nothing renamed". → verify: test with a colliding path and no qualifying cluster asserts failure
- [ ] 6.19 Under `--relabel`, leave clusters whose existing name is already in the library untouched and decide only still-anonymous clusters. → verify: test asserts a previously assigned name survives a second pass

## 7. End-to-end validation on real audio

Not unit tests — a manual gate. Automated tests must not depend on these files.

- [ ] 7.1 Sanity: enroll from a recording, then label that same recording. Expect a 1:1 map at high similarity. Reference run: 3/3 at cos 0.89–0.99. → verify: table matches
- [ ] 7.2 Rejection: an un-enrolled speaker in that recording stays anonymous. Reference: 0.252 against a 0.35 threshold. → verify: reported UNKNOWN
- [ ] 7.3 Cross-video: label a **different** recording with the same people. Reference: cos 0.72 / 0.89. → verify: correct names assigned
- [ ] 7.4 Negative control: label a recording of different people; expect mostly UNKNOWN. Beware — a person who attends both meetings is a **true** positive, not a false one; check the transcript before calling it an error. → verify: rejections dominate and any match is explained
- [ ] 7.5 Separation: `list` shows enrolled voices well apart. Reference: 0.05 / −0.46 / −0.61. → verify: no pair near the accept threshold
- [ ] 7.6 Timing: a 90-minute recording profiles in roughly 12 s CPU with the default model, measuring **embedding only**; measure and record decode separately rather than folding it into that budget. → verify: measured and recorded
- [ ] 7.7 Measure the cohort space against the fallback space: score the same clusters twice — once centered by a multi-recording cohort mean, once by the labeled recording's own mean — and compare the two score distributions. The `+ margin` fallback penalty is a guess until this reports; adjust or drop it on the result, and record the outcome in `design.md` §3b. → verify: both distributions tabulated in `reference/BENCHMARK.md`, penalty justified or removed
- [ ] 7.8 Test cross-recording matching where the enrolled and labeled recordings use **different capture setups**, since centering cannot remove the target recording's own channel direction (§3b). → verify: scores recorded; if they collapse, the limitation is documented in the skill

## 8. Documentation (DOX write discipline)

- [ ] 8.1 Add a `speaker-id` skill under `.pi/skills/`, or extend the existing one, with triggers, procedure, pitfalls and limitations. → verify: frontmatter valid, skill loads
- [ ] 8.2 Port `reference/BENCHMARK.md` into the package and reference it from the skill — it is the justification for the model default. → verify: linked and reachable
- [ ] 8.3 State the limitations plainly: no overlapping speech, cannot split an already-impure cluster, segment-level accuracy is a lower bound from noisy ground truth. → verify: present in the skill
- [ ] 8.4 Document the voiceprint store as biometric-derived data: explicit location, overridable, never committed. → verify: README section; `.gitignore` covers any in-repo path
- [ ] 8.5 Update `README.md` with the new CLI and the optional native dependency. → verify: commands run as documented
- [ ] 8.6 Add a row per new file to `src/AGENTS.md` and `src/bin/AGENTS.md`, path-alphabetical, with `See change: add-speaker-id-enrollment`. → verify: one row per new file, none missing
- [ ] 8.7 Update the package `AGENTS.md` rows for `README.md` and the skill. → verify: rows reflect the new capability
- [ ] 8.8 Delete `~/Documents/.pi/skills/speaker-id-enrollment/` once this lands, so there is one implementation. → verify: path gone; the ported tool covers every subcommand
- [ ] 8.9 Document that `enroll` stores derived embeddings of the source recording's **other** speakers to keep the centering pool multi-speaker, and how `forget` erases them. → verify: README + skill both state it
- [ ] 8.10 Register the `pi-voiceid` bin and any new `pi.tools` probe entries in `package.json`. → verify: a fresh install exposes the command; probes match the package's existing convention

## 9. Close-out

- [ ] 9.1 Full package suite green, including the pre-existing transcription tests. → verify: `pnpm test` in the package
- [ ] 9.2 Verify with the optional dependency absent: transcription works, speaker-id fails with the actionable message. → verify: install without optional deps and run both
- [ ] 9.3 `npm pack --dry-run` contains no model and no voiceprint data. → verify: file list inspected
- [ ] 9.4 Sync the delta spec into `openspec/specs/speaker-id-enrollment/`. → verify: `openspec` validation passes

## 10. Test scenarios (folded from `test-plan.md`)

Every row of the manifest maps here. `automated` rows carry the scenario Triple
and the nearest existing test to copy harness glue from; `manual-only` rows are
verified post-merge and fold no test.

Harness exemplars: L1 unit → `packages/video-transcription/src/__tests__/srt.test.ts`
(pure module + fixture style) and `.../ffmpeg.test.ts` (injected-runner style);
L2 smoke → `qa/tests/01-install.sh`.

### 10.1 Gates and decision logic (L1)

- [ ] 10.1.1 Threshold boundary — see `src/__tests__/srt.test.ts`. cos 0.349/0.350/0.351 vs one voiceprint, cohort trusted · `label` runs · 0.349 keeps the anonymous label with reason below-threshold, 0.350 and 0.351 rename (test-plan #E1)
- [ ] 10.1.2 Margin boundary — see `src/__tests__/srt.test.ts`. two voiceprints, best 0.80, runner-up 0.71/0.70/0.69 · `label` runs · margin 0.09 rejects as ambiguous, 0.10 and 0.11 rename (test-plan #E2)
- [ ] 10.1.3 Vote boundary — see `src/__tests__/srt.test.ts`. 10 sampled segments, 4 then 5 agreeing · `label` runs · 0.40 rejects as weak-vote, 0.50 renames (test-plan #E3)
- [ ] 10.1.4 Minimum-segment boundary — see `src/__tests__/srt.test.ts`. clusters of 2 and 3 sampled segments at cos 0.99 · `label` runs · 2 rejects as insufficient-segments, 3 renames (test-plan #E4)
- [ ] 10.1.5 Single voiceprint, no runner-up — see `src/__tests__/srt.test.ts`. exactly one voiceprint, cluster at 0.40 then 0.46 · `label` runs · 0.40 rejected at the raised 0.45, 0.46 renamed, report says margin+vote not evaluated (test-plan #E5)
- [ ] 10.1.6 Raises do not stack — see `src/__tests__/srt.test.ts`. one voiceprint AND cohort 12, cluster 0.50 · `label` runs · renamed at effective 0.45 not 0.55, both reasons reported (test-plan #E6)
- [ ] 10.1.7 `--force-fallback-thresholds` is scoped — see `src/__tests__/srt.test.ts`. one voiceprint, cohort 12, cluster 0.40, flag set · `label` runs · still rejected, single-voiceprint raise survives (test-plan #E7)
- [ ] 10.1.8 Drift merge reported — see `src/__tests__/srt.test.ts`. two clusters matching one voiceprint · `label` runs · both renamed and the merge reported (test-plan #E36)

### 10.2 Centering pool (L1)

- [ ] 10.2.1 Cohort minimum boundary — see `src/__tests__/config.test.ts`. cohort of 39 then 40 embeddings across 3 speakers · `label` runs · 39 reports the fallback mean, 40 the cohort mean (test-plan #E8)
- [ ] 10.2.2 Dominance boundary — see `src/__tests__/config.test.ts`. pool with one speaker at 69% then 71% of audio duration · centering mean requested · 69% proceeds, 71% reports cannot-compensate and renames nothing (test-plan #E9)
- [ ] 10.2.3 Dominance reads duration not sampled counts — see `src/__tests__/config.test.ts`. 95/5 duration split that the per-cluster cap equalises to ~50/50 segments · centering mean requested · guard still fires (test-plan #E10)
- [ ] 10.2.4 Dominance applies to the cohort — see `src/__tests__/config.test.ts`. cohort ≥40 embeddings but 90% one speaker · `label` runs · rejected as a pool (test-plan #E11)
- [ ] 10.2.5 Fewer than two speakers — see `src/__tests__/config.test.ts`. single-cluster recording, no cohort · `label` runs · reports it cannot compensate, never centers on that speaker's own mean (test-plan #E12)

### 10.3 Library, cohort accounting and erasure (L1)

- [ ] 10.3.1 Weighted merge — see `src/__tests__/config.test.ts`. voiceprint of 10 segments re-enrolled from 30 · `enroll` runs · stored vector is the 10:30 weighted mean, sources hold both recordings (test-plan #E13)
- [ ] 10.3.2 Replace semantics — see `src/__tests__/config.test.ts`. existing voiceprint plus `--replace` · `enroll` runs · previous vector gone, sources reset (test-plan #E14)
- [ ] 10.3.3 Contributes exactly once — see `src/__tests__/config.test.ts`. recording R already contributed, enroll a second speaker from R · `enroll` runs · voiceprint added, cohort sum and count unchanged (test-plan #E15)
- [ ] 10.3.4 Content-derived recording id — see `src/__tests__/discover.test.ts`. same media bytes at two paths · `enroll` twice · ids equal, second run does not contribute (test-plan #E16)
- [ ] 10.3.5 Forget then re-contribute — see `src/__tests__/config.test.ts`. `forget --recording R` then enroll from R · `enroll` runs · cohort grows (test-plan #E17)
- [ ] 10.3.6 Exact erasure — see `src/__tests__/config.test.ts`. contributions A,B,C then forget B · `forget` runs · derived mean bit-identical to a library built from A,C (test-plan #E18)
- [ ] 10.3.7 Order-independent mean — see `src/__tests__/config.test.ts`. same contributions in shuffled storage order · mean derived · bit-identical across orderings (test-plan #E19)
- [ ] 10.3.8 Forget by name reaches the pool — see `src/__tests__/config.test.ts`. recording with enrolled Alice and an unenrolled co-speaker · `forget Alice` · Alice's voiceprint and contributions gone, co-speaker's contribution remains (test-plan #E20)
- [ ] 10.3.9 Unnamed contributions are visible and not name-erasable — see `src/__tests__/config.test.ts`. cohort holding a never-enrolled speaker · `list` then any `forget <name>` · listed as unnamed and surviving (test-plan #E21)
- [ ] 10.3.10 Store path precedence — see `src/__tests__/config.test.ts`. flag, env var and default all set · any command · flag wins, env used without a flag, `$HOME` default never created when overridden (test-plan #E37)
- [ ] 10.3.11 Malformed store degrades to empty — see `src/__tests__/config.test.ts`. absent file, then invalid JSON · load · both yield an empty library without throwing (test-plan #E38)
- [ ] 10.3.12 Vector-math guards — see `src/__tests__/srt.test.ts`. zero vector, and a vector equal to the mean · `centre`/cosine · defined result, no NaN (test-plan #E39)

### 10.4 SRT parsing and relabeling (L1)

- [ ] 10.4.1 Label form parity — see `src/__tests__/srt.test.ts`. SRTs using `[Speaker 2]` and `[2]` · parse · same cluster id (test-plan #E22)
- [ ] 10.4.2 Non-speaker brackets — see `src/__tests__/srt.test.ts`. `[music]` cue among `[Speaker N]` cues · parse then `label` · unlabeled, no cluster, transcript not treated as already-labeled (test-plan #E23)
- [ ] 10.4.3 Already-labeled refusal — see `src/__tests__/srt.test.ts`. SRT labeled `[Alice]`, and one labeled `[Interviewer]` · `label` without `--relabel` · both refused, `--relabel` proceeds (test-plan #E24)
- [ ] 10.4.4 Relabel preserves assigned names — see `src/__tests__/srt.test.ts`. `*.named.srt` with enrolled `[Alice]` and `[Speaker 3]` · `label --relabel` · Alice untouched, only cluster 3 decided (test-plan #E25)
- [ ] 10.4.5 Separator and BOM variants — see `src/__tests__/srt.test.ts`. SRTs with `,` and `.` separators, with and without a BOM · parse · identical cue sets (test-plan #E26)
- [ ] 10.4.6 Parse round-trip — see `src/__tests__/srt.test.ts`. arbitrary SRT fixture · parse then re-render · timestamps and text byte-identical (test-plan #E27)

### 10.5 Media resolution and sampling (L1)

- [ ] 10.5.1 Extension precedence — see `src/__tests__/discover.test.ts`. dir holding `talk.mp4`/`.m4a`/`.mp3` beside `talk.srt` · media resolution · `.mp4` wins independent of readdir order (test-plan #E28)
- [ ] 10.5.2 Explicit audio wins — see `src/__tests__/discover.test.ts`. `--audio other.wav` with a sibling present · media resolution · `other.wav` used (test-plan #E29)
- [ ] 10.5.3 Sampling spans the timeline — see `src/__tests__/ffmpeg.test.ts`. cluster with cues across 0–90 min · segment sampling · picks span the full range, not a prefix (test-plan #E30)
- [ ] 10.5.4 Sampling determinism — see `src/__tests__/ffmpeg.test.ts`. one cluster fixture · sample twice · identical segments and vote share (test-plan #E31)
- [ ] 10.5.5 All-short fallback — see `src/__tests__/ffmpeg.test.ts`. cluster whose cues are all below the minimum duration · segment sampling · longest available returned, never empty (test-plan #E32)

### 10.6 Drift analysis (L1)

- [ ] 10.6.1 Drift threshold boundary — see `src/__tests__/srt.test.ts`. cluster pairs at 0.54/0.55/0.83 centered cosine · `analyze` runs · 0.54 unflagged, 0.55 and 0.83 flagged (test-plan #E33)
- [ ] 10.6.2 `analyze` takes no raise — see `src/__tests__/srt.test.ts`. `analyze` with no library · `analyze` runs · threshold stays 0.55, no `+ margin` (test-plan #E34)
- [ ] 10.6.3 Nothing to compare — see `src/__tests__/srt.test.ts`. SRT with one labeled cluster · `analyze` runs · reports nothing to compare, exit 0 (test-plan #E35)

### 10.7 Failure modes (L1)

- [ ] 10.7.1 Binding absent at import — see `src/__tests__/ffmpeg.test.ts`. module resolution throws · import `embedding.ts` · import succeeds, failure deferred (test-plan #X1)
- [ ] 10.7.2 Binding absent at first use — see `src/__tests__/ffmpeg.test.ts`. same · first embed call · message names the dependency and install command, never raw MODULE_NOT_FOUND (test-plan #X2)
- [ ] 10.7.3 Model absent — see `src/__tests__/config.test.ts`. empty cache, fetch stubbed to fail · `label` runs · error states the expected path and how to obtain it (test-plan #X4)
- [ ] 10.7.4 Truncated download — see `src/__tests__/config.test.ts`. fetch returns a short payload · download · rejected on size/checksum, no partial file (test-plan #X5)
- [ ] 10.7.5 Media missing — see `src/__tests__/discover.test.ts`. SRT with no sibling media and no `--audio` · `label` runs · fails naming every path tried, no output (test-plan #X6)
- [ ] 10.7.6 Media shorter than transcript — see `src/__tests__/ffmpeg.test.ts`. media 10 min, last cue 40 min · `label` runs · refused (test-plan #X7)
- [ ] 10.7.7 Trailing silence passes — see `src/__tests__/ffmpeg.test.ts`. media 90 min, last cue 87 min · `label` runs · proceeds (test-plan #X8)
- [ ] 10.7.8 Unknown duration skips — see `src/__tests__/ffmpeg.test.ts`. ffprobe absent or unparseable so duration is 0 · `label` runs · check skipped with a note, not read as infinite mismatch (test-plan #X9)
- [ ] 10.7.9 Model/dim mismatch — see `src/__tests__/config.test.ts`. voiceprint from model X, active model Y · `label` runs · fails naming affected voiceprints, no SRT written (test-plan #X10)
- [ ] 10.7.10 Same dim different model — see `src/__tests__/config.test.ts`. two 192-dim models with different names · `label` runs · refused on the model name (test-plan #X11)
- [ ] 10.7.11 Mixed-model cohort — see `src/__tests__/config.test.ts`. contributions from model X, active Y, no model-X voiceprint left · `label` runs · refused, contributions not reset (test-plan #X12)
- [ ] 10.7.12 Concurrent enrollment — see `src/__tests__/run.test.ts`. two processes enrolling different people into one store · both run · both enrollments present (test-plan #X13)
- [ ] 10.7.13 Interrupted write — see `src/__tests__/run.test.ts`. write throws mid-way · `enroll` runs · store is previous or complete, never truncated, no stray temp (test-plan #X14)
- [ ] 10.7.14 Stale lock — see `src/__tests__/run.test.ts`. lock file older than the staleness age · `enroll` runs · lock broken and acquired, profiling ran outside the critical section (test-plan #X15)
- [ ] 10.7.15 Output collision — see `src/__tests__/run.test.ts`. `--output` equal to input, a hard link, and a case-only alias · `label` runs · all three refused by device+inode before gate evaluation (test-plan #X16)
- [ ] 10.7.16 Collision beats "nothing renamed" — see `src/__tests__/run.test.ts`. colliding output AND no qualifying cluster · `label` runs · fails on the output path, not exit 0 (test-plan #X17)
- [ ] 10.7.17 Dry run — see `src/__tests__/run.test.ts`. qualifying clusters plus `--dry-run` · `label` runs · table printed, no file created (test-plan #X18)
- [ ] 10.7.18 No cluster qualifies — see `src/__tests__/run.test.ts`. every cluster below threshold · `label` runs · no output, reports nothing renamed, non-zero exit (test-plan #X19)
- [ ] 10.7.19 Temp cleanup on failure — see `src/__tests__/ffmpeg.test.ts`. decode throws mid-run · `label` runs · no leftover decoded audio (test-plan #X20)
- [ ] 10.7.20 Silent and short windows — see `src/__tests__/ffmpeg.test.ts`. window below minimum duration, and a pure-silence window · embed · both skipped (test-plan #X21)
- [ ] 10.7.21 Streaming decode — see `src/__tests__/ffmpeg.test.ts`. 90-minute fixture or an equal-length synthetic stream · full decode · peak RSS stays bounded, proving no whole-file buffer (test-plan #P3)

### 10.8 Packaging and runtime (L2)

- [ ] 10.8.1 Optional dep stays optional — see `qa/tests/01-install.sh`. clean install with optional deps skipped · install · exits 0 and `pi-transcribe` runs (test-plan #S1)
- [ ] 10.8.2 Transcription unaffected — see `qa/tests/01-install.sh`. same install · run both CLIs · transcription succeeds, `pi-voiceid` fails with the actionable message (test-plan #X3)
- [ ] 10.8.3 Bin registration — see `qa/tests/01-install.sh`. fresh install · `pi-voiceid --help` per subcommand · each help renders (test-plan #S2)
- [ ] 10.8.4 Per-platform binaries — see `qa/tests/01-install.sh`. each supported platform · install and import · binding loads, or the platform is recorded as degraded in `design.md` (test-plan #S3)
- [ ] 10.8.5 Package contents — see `qa/tests/01-install.sh`. `npm pack --dry-run` · inspect file list · no ONNX model, no voiceprint data, size near current (test-plan #S4)

### 10.9 Manual verification (no test folded)

- [ ] 10.9.1 Profiling budget: 90-minute recording profiles in ~12 s embedding-only CPU (test-plan: manual-only)
- [ ] 10.9.2 Decode time measured and reported separately from the embedding budget (test-plan: manual-only)
- [ ] 10.9.3 Self-consistency: enroll 3 speakers from recording A, label A, expect a 1:1 map at cos 0.89–0.99 (test-plan: manual-only)
- [ ] 10.9.4 Rejection: an un-enrolled speaker in A stays anonymous, reference 0.252 (test-plan: manual-only)
- [ ] 10.9.5 Cross-video: label recording B with the same people, reference cos 0.72/0.89 (test-plan: manual-only)
- [ ] 10.9.6 Negative control: a recording of different people yields mostly rejections; any match explained against the transcript (test-plan: manual-only)
- [ ] 10.9.7 Separation: `list` shows enrolled voices well apart, reference 0.05 / −0.46 / −0.61 (test-plan: manual-only)
- [ ] 10.9.8 Cohort space vs fallback space: tabulate both score distributions in `reference/BENCHMARK.md`; justify or remove the `+ margin` penalty per design §3b (test-plan: manual-only)
- [ ] 10.9.9 Cross-capture-setup matching: enrolled from a conference capture, labeled from a phone memo; record scores and document the limitation if they collapse (test-plan: manual-only)
