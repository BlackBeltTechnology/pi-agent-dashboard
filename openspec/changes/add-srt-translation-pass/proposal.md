## Why

`pi-transcribe` produces speaker-diarized SRT in the source language only. Translating a meeting today means a manual copy-paste pass with no guarantee the translated file still lines up with the audio.

The obvious shortcut — hand the raw audio to a multimodal model and ask for a translated transcript — was measured and rejected. On a 5-minute Hungarian slice, `qwen3.8-omni-flash` produced *better* prose than the Soniox SRT (clean sentence units vs 80% of Soniox cues starting mid-word) at 1/5 the cost, but **silently truncated at 210s of 300s**: no error, `finish_reason` normal, 15% of the words simply absent. A transcription tool that can drop the middle of a meeting without saying so is unusable as a record.

So: keep the ASR backend as the exhaustive timing + diarization spine, and translate its **text** — where every cue is accounted for and the count can be asserted.

## What Changes

- New `pi-translate-srt` bin: reads an existing `.srt`, writes a sibling named by replacing the final `.srt` with `.<lang>.srt` (`talk.diarize.srt` → `talk.diarize.en.srt`).
- Timing is preserved by value. Index, start/end millisecond values, order, and the `[Speaker N]` label prefix carry through unchanged; only the spoken text is replaced. Non-canonical `.` millisecond separators are normalised to `,` and reported.
- Source integrity is established first: parsed cues are counted against an independent count of **timing lines**, so a partially-parsed source — including two cues fused without a separating blank line — fails instead of being silently translated short. An empty or unparseable source is an error.
- Cues are sent in batches with explicit **ordinal position** as the identifier (not the source index, which the parser may synthesise and which can therefore collide). The reply **must** account for every sent position exactly once, in order — missing, duplicated, unsent, reordered, unparseable, or blanked cues are a batch failure.
- On failure the batch is split into two halves and both retried once, then the file fails. A partial or silently-shortened translation is never written to disk.
- Atomic output: temp sibling + rename + cleanup on failure, so a crash cannot leave a partial file or destroy a previous translation.
- Files are independent: one file's failure does not discard another's output. Up-to-date outputs are skipped, stale ones re-translated, with an explicit override. A single refractory cue degrades to pass-through rather than failing the file.
- Transport failures retry with bounded backoff before verification retries; the two are reported distinctly.
- Translation backend is an OpenAI-compatible chat endpoint (default DashScope `qwen3.8-flash`, verified reachable), configured via `TRANSLATE_API_KEY` / `TRANSLATE_MODEL` / `TRANSLATE_BASE_URL` / `TRANSLATE_TARGET_LANG`.
- Transcription behaviour is unchanged. No changes to `soniox.ts`, `assemblyai.ts`, `run.ts`, or `transcribe.ts`.

## Capabilities

### New Capabilities
- `srt-translation`: translate an existing SRT into a target language while preserving cue timing, ordering, and speaker labels, with a total-cue-count guarantee that fails loudly rather than emitting a partial file.

### Modified Capabilities
<!-- none: the transcription pipeline's requirements are unchanged; this adds a
     separate downstream surface that consumes its output. -->

## Impact

**New files**
- `packages/video-transcription/src/translate.ts` — batching, response parsing, cue-count assertion, client.
- `packages/video-transcription/src/bin/translate.ts` — `pi-translate-srt` entry.
- `packages/video-transcription/src/__tests__/translate.test.ts`.

**Modified**
- `packages/video-transcription/package.json` — one `bin` entry, and `TRANSLATE_API_KEY` added to the env-probe list as **`optional: true`** (`SONIOX_API_KEY` is currently non-optional, so a non-optional translate key would make every transcribe-only install report a missing tool).
- `packages/video-transcription/src/config.ts` — **refactor**, not an addition. `loadConfig` currently both resolves env-then-`.env` precedence *and* throws when a per-backend transcription key is missing, with `readEnvFile` private; a translate-only run would therefore demand `SONIOX_API_KEY`. The precedence logic is extracted, preserving both `.env` legs (current directory and package directory), and `loadConfig` is rebuilt on top of it. Acceptance is behaviour preservation for existing callers, not merely a green suite.
- `packages/video-transcription/src/srt-parse.ts` — export the block-level parsing helper needed to name the first unaccounted-for timing line, rather than duplicating its timestamp pattern in the new module.
- `packages/video-transcription/src/__tests__/config.test.ts` — regression gate for the refactor.
- `packages/video-transcription/src/__tests__/packaging.test.ts` — asserts the exact bin set, so it breaks until it covers the third bin.
- `packages/video-transcription/README.md` — documents bins and the env-override table; a row is required.
- `packages/video-transcription/.pi/skills/video-transcription/SKILL.md` — usage section gains the new bin.
- Directory `AGENTS.md` rows for the new files.

**New discovery code (correcting an earlier assumption)**: `discover.ts` handles media extensions only and throws `Unsupported file type` for an explicit `.srt` argument, so `.srt` selection is new, stated work. Media discovery is untouched.

**Reused unchanged**: `parseSrtFile`, `parseSrt`, `renderSrt`, `Cue`, `formatCueTime`, and the label taxonomy from `srt-parse.ts`.

**Dependencies**: none added. `fetch` is injected as a seam so tests need no network.

**Risk carried by the refactor**: `config.ts` is a shared module that `run.ts` and `transcribe.ts` depend on. Keeping `config.test.ts` green is the regression gate; the refactor lands before any caller changes.

**Known limitation (deliberately out of scope)**: `media-resolve.ts`'s `mediaStem` strips `.diarize.srt`/`.named.srt`/`.srt` but will not strip `.diarize.en.srt`, so `pi-voiceid` cannot resolve sibling media from a translated SRT. Translated files are a terminal output, not a speaker-id input; revisit only if that workflow is wanted.

**Accepted residual risk**: a reply that returns every position exactly once with cue texts attached to the wrong positions is internally consistent and cannot be detected by any positional check. Order is verified and a length heuristic is recorded as an **advisory note only** (legitimate divergence is large, so it never fails a batch); correct-translation is not a checkable property. Documented in design.md.

**Verified model**: `qwen3.8-flash` on `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`, confirmed by live probe returning `OK`. Reviewers flagged the unverifiable id; the endpoint and result are recorded so the claim is repeatable.

**Cost**: text-only translation of a 50-minute meeting is roughly $0.01 at `qwen3.8-flash` rates ($0.15/$0.47 per 1M tokens).

## Discipline Skills

- `review-code` — non-trivial change, run before commit.
- `systematic-debugging` — if the cue-count assertion fires against the live API, root-cause the batching rather than loosening the assertion.
- `security-hardening` — the API key is read from env/`.env` and must never reach an SRT, a log line, or an error message.
- `observability-instrumentation` — the change adds a new external call; per-file outcomes, transport-vs-verification failure classes, and coverage counts must be reportable.
- `doubt-driven-review` — already applied across three cycles during planning; re-invoke if the retry or integrity design changes during implementation.
