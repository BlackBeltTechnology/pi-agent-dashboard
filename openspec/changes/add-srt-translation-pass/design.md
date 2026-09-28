## Context

`srt-parse.ts` provides the data layer: `Cue`, `parseSrt`, `parseSrtFile`, `renderSrt`, `formatCueTime`, and the label taxonomy (`LABEL_RE`, `ANON_RE`, `isSoundAnnotation`, `normalizeLabel`). Cue timing therefore never has to be reconstructed — it is parsed, carried, and re-rendered by existing tested code.

Three package precedents constrain the design: **atomic writes with temp cleanup** (`voiceprint.ts` — temp sibling, `renameSync`, `rmSync(tmp)` on failure), **transport retry** (`assemblyai.ts` — 429/5xx with `Retry-After`), and **per-file isolation with a summary** (`run.ts` — pool with per-file try/catch).

Three rounds of adversarial review have shaped this document. Claims that earlier versions made and could not support are marked **[CORRECTED]**; residual risks are stated as accepted rather than papered over.

See proposal.md — Why for the measurement that motivates the cue-count guarantee.

## Goals / Non-Goals

**Goals:**
- Translation is a pure function of cue text plus a backend call; timing never passes through the model.
- The failure mode observed in testing (silent truncation) is structurally impossible to write to disk — at both the parse layer and the translation layer.
- Testable without network access.

**Non-Goals:**
- Translating audio directly. Measured and rejected.
- Re-segmenting or merging cues for readability. The backend's mid-word splits are ugly but they are the timing contract.
- Speech output. Text only.
- Preserving multi-line cue text. The parser flattens it to one line; inherited, documented, not fixed.
- Making translated SRTs valid inputs to `pi-voiceid` — see Risks for the resulting behaviour.

## Decisions

**Integrity counts timing lines, not blocks. [CORRECTED]**

The first revision proposed counting blank-line-delimited cue-shaped *blocks*. That misses the case it exists to catch: `parseBlock` reads only the **first** matching timing line in a block, so two cues fused without a separating blank line parse as one cue — and the block count also says one. The swallowed timing line then becomes cue *text* and is sent to the model as speech. Counting **timing lines** (lines containing the arrow) makes fused cues a detected mismatch: 2 lines, 1 parsed cue.

The count's tolerance must be a superset of the parser's: CRLF, byte-order marks, and whitespace-only separators must be handled the same way, or the counter rejects files the parser accepts. Counting arrow-bearing lines rather than splitting on separators achieves this naturally.

**Identifiers are ordinal positions, not source index values. [CORRECTED]**

`parseBlock` synthesises an index when a block omits its index line, so a synthesised `1` can collide with a later explicit `1`. Using source indices as wire identifiers would make two cues indistinguishable, and a per-id count check could not then tell a source-level duplicate from a backend duplicate. Wire identifiers are therefore the cue's **ordinal position**; source index values are carried separately and re-emitted. This removes the collision entirely and makes the multiset check unambiguous.

**Verify a per-position multiset, plus order. [CORRECTED]**

An early draft claimed set comparison "catches duplication". It does not: sent `{1,2,3}` against a reply of `1,2,3,3` yields identical sets, and building an id-keyed map silently drops the duplicate. The check compares **counts per position**, scans for positions never sent, and compares the **sequence** of returned positions against the request order, so a reordered reply fails.

**Accept that content-to-position misassignment is undetectable, and say so.**

The dominant residual failure is a reply returning every position exactly once with texts attached to the wrong positions. No positional check can detect this, because the positions are internally consistent. Mitigations: cues are sent in order and never shuffled, order is verified, and a per-cue length heuristic is recorded. Beyond that it is accepted risk. Verifying that a translation is *correct* is not a checkable property.

**The length heuristic is an advisory note, never a failure.**

It flags a cue whose translated length diverges grossly from its neighbours' ratio and from its own source length. It **never** fails a batch or a file, because legitimate divergence is large (English→Chinese can shrink 2–3×; single-word answers are legitimately tiny). It is recorded per file in the summary so a human can spot-check. An earlier draft listed it as a "mitigation" without defining its effect, which made it unimplementable.

**Batch with explicit positions; retry by halving, once, depth one.**

Batches of 40 carry enough context for pronouns and clause continuations; one request per cue was rejected (1,325 requests for a 50-minute meeting, no cross-cue context). On failure the batch is split into **two halves and both retried once**. Halving depth is exactly one: a halved batch that fails again fails the file. A batch of size 1 is retried once unchanged, then fails — it cannot be halved. A half that already verified is not re-requested.

**Two retry layers, ordered explicitly. [CORRECTED]**

Inner layer: transport retry — bounded attempts with backoff on 429/5xx (honouring `Retry-After`) **and** on rejected connections, since a transient network failure is the same class as a 5xx. Every request carries a timeout, so a hung endpoint cannot stall the sequential loop. When transport attempts are exhausted the batch is a **transport failure** and does **not** enter the halving path — halving would not help a batch that never reached the backend. Halving applies only to **verification** failures. The two are reported distinctly.

**A refractory cue degrades to pass-through instead of failing the file.**

A cue whose source text is substantive but which returns blank across the retry has its **source text emitted unchanged** and is reported. Failing an entire meeting transcript over one unfortunate cue is worse than emitting one untranslated line labelled as such. This also closes the interaction with pass-through logic: a cue containing only symbols (`♪`, `---`) is not annotation-bracketed, gets sent, and may come back empty — which would otherwise fail the file.

**Pass-through detection is new logic, not inherited. [CORRECTED]**

`splitLabel` keeps an annotation like `[music]` inside `text`; it does not classify the cue as non-spoken. A dedicated predicate ("source text contains no letters or digits") is required, and is new code, not a reuse of `isSoundAnnotation`.

**Establish source integrity before translating; empty means error.**

Empty or unparseable sources are an error with no output written, not a successful zero-cue run.

**Atomic write via temp sibling, rename, and cleanup on failure.**

`saveSrt` is `fs.writeFileSync`, which truncates the target before writing — a crash mid-write leaves a partial file *and* destroys the previous output, contradicting the no-partial-output guarantee. The write follows `voiceprint.ts` exactly, **including** `rmSync(tmp, { force: true })` in the failure path, so a crash does not accumulate orphaned temp siblings. All of a file's batches are buffered in memory and written once.

**Output name: replace the final `.srt`, keep the backend suffix.**

`talk.diarize.srt` → `talk.diarize.en.srt`. Stripping `.diarize` would map `talk.srt` and `talk.diarize.srt` onto the same `talk.en.srt`, so one source's translation would be silently skipped as already done for the other. Replacement, not stripping, gives every source a distinct output.

**Existing translations are never sources.** Discovery excludes any file already matching a translated naming pattern **for any language**, not just the current target. Otherwise `talk.de.srt` would be treated as a source and produce `talk.de.en.srt` — two competing English translations, no warning. Extension matching is case-insensitive to match existing discovery behaviour.

**Validate the target language before it reaches a path.**

Accepted form `^[a-z]{2}(-[A-Z]{2})?$`, checked before any path is constructed. The output-equals-source refusal is retained as a cheap belt-and-braces guard even though validation alone makes it unreachable.

**Resolve credentials lazily — "no work" is not a failure.**

Resolved after discovery and skip-filtering. If nothing needs translating, or no subtitle files are found, report that and exit successfully. This also keeps the run usable for a dry inspection.

**Refactor the resolver out of backend-key validation.**

`loadConfig` both resolves env-then-`.env` precedence *and* throws when a per-backend transcription key is missing; `readEnvFile` is private. A translate-only run would demand `SONIOX_API_KEY`. The precedence logic is extracted so the translate path can use it without transcription-key validation.

The resolver must preserve **both** `.env` legs — current directory *and* the package directory — because keys may live in either. The existing `skillDir` default resolves to `src/`, which is dead for the package-root `.env`; the refactor preserves current behaviour for existing callers and covers both directories for the new one, and this divergence is noted rather than silently inherited.

Because `config.ts` is depended on by `run.ts` and `transcribe.ts`, the acceptance criterion is **behaviour preservation for existing callers**, with `config.test.ts` as the regression gate — not merely "the suite passes". Cases are added for the translate path before `loadConfig` is rebuilt.

**Name the credential variable, and mark the probe optional.**

`TRANSLATE_API_KEY`, alongside `TRANSLATE_MODEL`, `TRANSLATE_BASE_URL`, `TRANSLATE_TARGET_LANG`. The variable name is part of the contract because the spec requires the error to name it. In the package's env-probe list it must be **`optional: true`** — `SONIOX_API_KEY` is currently non-optional, so adding a translate key non-optionally would make every transcribe-only install report a missing tool, and making it optional is what allows a translate-only run to proceed without a transcription key.

**`.srt` discovery is new code. [CORRECTED]**

`discover.ts` discovers media extensions only, and an explicit argument with a `.srt` extension throws `Unsupported file type`. The translate bin cannot "mirror `discover.ts` resolution semantics" as an earlier draft claimed; `.srt` selection is new, stated work. Media discovery is untouched.

**Private parser helpers may need exporting. [CORRECTED]**

Naming the first unaccounted-for position requires reaching block-level parsing, which `parseBlock`/`findTimeLine` do not currently export. Either they are exported (a small, tested change to a shared module) or the integrity check reimplements the timestamp pattern. The proposal's "reused unchanged" claim was wrong about this; exporting is preferred over duplicating a regex that must then stay in sync.

**Freshness compares modification times.**

Output at least as new as source → skip. Source strictly newer → re-translate. Explicit override → always. Equal timestamps skip, so a timestamp-preserving copy does not trigger a re-translation. A corrupt-but-newer output is skipped until the override is used; this is stated rather than hidden.

**Per-file isolation, matching `run.ts`.**

One file's failure does not abort the run or discard other files' translations. Files are processed with the existing pool convention, or sequentially if the pool adds no value — stated once, not left ambiguous. Concurrent runs racing the mtime check are out of scope; the package has a store-lock precedent but no lock is added here.

**Injected `fetch`.**

Matches the existing `fetchImpl` seam in `soniox.ts`/`assemblyai.ts`. Tests exercise batching, halved retry, multiset mismatch, reordering, unparseable replies, and abort with a stub; no key, no network, no rot-prone fixtures.

**Model choice, with evidence.**

`qwen3.8-flash` on DashScope's OpenAI-compatible endpoint, verified by live probe against `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` returning `OK`. Reviewers correctly flagged that an unverifiable id is a liability, so the endpoint and the probe result are recorded here rather than asserted. The spike that motivated this change used `qwen3.8-omni-flash` (audio); the translation pass is text-only, where the two share pricing.

## Risks / Trade-offs

- **Content-to-position misassignment** → accepted and documented; order verification and the advisory length note reduce but cannot eliminate it.
- **Model emits a position-like token inside translated text** → replies are parsed with an anchored pattern and a required response shape; a reply that cannot be mapped unambiguously fails the batch and routes into retry-then-fail. Ambiguity is never resolved by guessing. The request/response serialization is pinned in the task list rather than left to prose.
- **Cross-batch context loss at boundaries; halved retries re-translate under narrower context** → accepted. A retried cue may read slightly differently from its batch-mates. Overlapping windows were rejected: they reintroduce ambiguity about which copy of a cue is authoritative.
- **Batch sized by count, not tokens** → a batch of very long cues can exceed the input cap, and halving may not fix a single oversized cue. Accepted; the measured corpus has ~5s cues.
- **Multi-line cue text is flattened** → inherited from the parser, documented, not fixed.
- **Spaced labels and synthesized indices are canonicalised** → the spec says "appears at the start" and "reported rather than silent" rather than promising byte-identical label lines, which the parser does not provide. Timing-line trailing coordinates (SRT placement) are matched and dropped by the parser; unchanged here, and noted.
- **`mediaStem` does not strip `.diarize.en.srt`** → `pi-voiceid` will *throw* "no media file found" on a translated SRT rather than skip it. Translated files are a terminal output; this is warned about in the skill docs rather than fixed.
- **Per-cue token overhead** → amortized by batching; ~$0.01 per 50-minute meeting.
- **The `config.ts` refactor can regress transcription** → mitigated by behaviour-preservation tests before `loadConfig` is rebuilt.
- **`packaging.test.ts` asserts the exact bin set** → adding a bin breaks it until updated; it is a required task, not incidental.

## Migration Plan

No migration: this adds a bin and a capability. The `config.ts` refactor is internal — `loadConfig`'s signature and its callers' behaviour are unchanged, and the existing suite is the regression gate. Rollback is deleting the new files and reverting one `package.json` bin entry and the optional probe row.

## Open Questions

- Whether to expose batch size on the CLI. Deferred: changes no spec behaviour.
