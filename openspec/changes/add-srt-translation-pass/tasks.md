## 1. Red tests — source integrity and timing (L1)

Harness exemplar: extend `src/__tests__/srt-parse.test.ts` conventions (vitest, fixture strings inline).

- [ ] 1.1 Integrity nominal: 4-cue canonical fixture, 4 timing lines → parsed count 4 == timing-line count 4, proceeds. (test-plan #E1)
- [ ] 1.2 Integrity fused-cue boundary: one block holding TWO timing lines then text → count 2 != parsed 1 → abort naming both counts and the unaccounted position. (test-plan #E2)
- [ ] 1.3 Integrity tolerance: same file as CRLF + BOM + whitespace-only separator → counts equal, no false abort. (test-plan #E3)
- [ ] 1.4 Integrity empty input: zero-byte file → error, no output written. (test-plan #E4)
- [ ] 1.5 Integrity invalid input: non-empty text with zero arrow lines → error, no output written. (test-plan #E5)
- [ ] 1.6 Missing index lines: 3 cues without indexes → 3 parsed, integrity passes, synthesised indexes reported. (test-plan #E6)
- [ ] 1.7 Timing separator class: source using `.` ms separator → output uses `,`, ms values unchanged, normalisation reported as a note. (test-plan #E7)
- [ ] 1.8 Timing invariant: 4-cue fixture + stub backend → 4 cues out, each start/end ms equal to input, order unchanged. (test-plan #E8)
- [ ] 1.9 Label preserved: cue `[Speaker 2] hello there` → output starts `[Speaker 2]`; captured request payload contains no `Speaker`. (test-plan #E9)
- [ ] 1.10 Pass-through annotation: cue text exactly `[music]` → emitted unchanged, counted, absent from payload. (test-plan #E10)
- [ ] 1.11 Pass-through symbol-only: cue text `♪ ♪` → emitted unchanged, counted, absent from payload. (test-plan #E11)
- [ ] 1.12 Positional identifiers: source with a synthesised index colliding with a later explicit index → wire ids are distinct ordinals 0..N-1. (test-plan #E12)

## 2. Red tests — naming, freshness, language, batching (L1)

- [ ] 2.1 Naming decision table: `talk.diarize.srt` + target `en` → `talk.diarize.en.srt`. (test-plan #E13)
- [ ] 2.2 Naming collision: `talk.srt` and `talk.diarize.srt` both present → distinct outputs, neither equals the other. (test-plan #E14)
- [ ] 2.3 Naming case-insensitivity: `TALK.SRT` recognised; output `TALK.en.srt`. (test-plan #E15)
- [ ] 2.4 Discovery exclusion: `talk.srt` + `talk.de.srt` + `talk.en.srt`, target `en` → only `talk.srt` is a source; both translations reported skipped. (test-plan #E16)
- [ ] 2.5 Freshness skip: output newer than source → skipped, zero backend calls. (test-plan #E17)
- [ ] 2.6 Freshness boundary: equal mtimes → skipped as up to date. (test-plan #E18)
- [ ] 2.7 Freshness stale: source newer → re-translated, output overwritten. (test-plan #E19)
- [ ] 2.8 Freshness override: output newer + override → translated regardless, backend called once. (test-plan #E20)
- [ ] 2.9 Language validation invalid: `../x` → run fails naming the value, no path constructed. (test-plan #E21)
- [ ] 2.10 Language decision table: unset / `en` / `hu` / `pt-BR` / `EN` → unset defaults to `en`; valid forms accepted per the stated pattern. (test-plan #E22)
- [ ] 2.11 Batching partition: 97 cues, size 40 → 40/40/17, union of ordinals == 0..96, no loss or duplicate. (test-plan #E23)
- [ ] 2.12 Retry boundary: single-cue batch rejected twice → retried once unchanged (not halved to an invalid size), then file fails. (test-plan #E24)
- [ ] 2.13 Refractory cue: one substantive cue blank on both attempts, others succeed → cue emits SOURCE text unchanged and is reported; file succeeds. (test-plan #E25)
- [ ] 2.14 Coverage invariant: 4 cues, 2 translated + 2 passed through → report states 2 + 2 == source 4. (test-plan #E26)

## 3. Red tests — error handling and transport (L1)

Fault injection via the injected `fetch` seam (exemplar: the runner seam in `src/__tests__/ffmpeg.test.ts`).

- [ ] 3.1 Omitted position: reply omits position 2 of 3 → halved retry, retry also omits → file fails naming position 2. (test-plan #X1)
- [ ] 3.2 Duplicate position: reply has position 1 twice, omits 2 → per-position count detects it → retry-then-fail. (test-plan #X2)
- [ ] 3.3 Unsent position: reply contains position 77 → detected → retry-then-fail. (test-plan #X3)
- [ ] 3.4 Unparseable reply: free prose with no positions → batch fails, retry-then-fail, no guessing. (test-plan #X4)
- [ ] 3.5 Reordered reply: positions returned as 2,0,1 → order check detects → retry-then-fail. (test-plan #X5)
- [ ] 3.6 Blank translation: substantive cue returns whitespace → batch fails; refractory rule applies on retry. (test-plan #X6)
- [ ] 3.7 Transport 429: `Retry-After: 2` then success → retried after the hint, final result succeeds. (test-plan #X7)
- [ ] 3.8 Transport abort: connection reset on every attempt → retried to the attempt bound, then declared a TRANSPORT failure. (test-plan #X8)
- [ ] 3.9 Transport delay: endpoint accepts and never responds → request times out, next batch still processed, run does not stall. (test-plan #X9)
- [ ] 3.10 Retry layering: transport attempts exhausted → classified transport failure, halving path NOT entered, zero half-requests sent. (test-plan #X10)
- [ ] 3.11 No partial output: pre-existing output present, later batch fails → pre-existing file byte-identical, no new file, no orphan `.tmp`. (test-plan #X11)
- [ ] 3.12 Per-file isolation: 3 files, middle fails → files 1 and 3 correct, summary lists 2 successes and 1 failure separately. (test-plan #X12)
- [ ] 3.13 Missing credential with work: 1 file to translate, no key → fails before any request, message names the var. (test-plan #X13)
- [ ] 3.14 No work, no credential: all outputs up to date, no key → exits successfully reporting skips. (test-plan #X14)
- [ ] 3.15 Credential leakage: backend auth error echoing the request → reported message contains no substring of the key. (test-plan #X15)
- [ ] 3.16 Atomic write failure: write fails mid-way (ENOSPC simulated) → temp sibling removed, target untouched, no orphan. (test-plan #X16)
- [ ] 3.17 Config regression: all pre-existing `config.test.ts` assertions pass with identical messages and precedence. (test-plan #X17)
- [ ] 3.18 Config `.env` legs: key only in cwd `.env`, then only in package `.env` → found in both; absent from both → fails naming the var. (test-plan #X18)

## 4. Implementation — integrity and translation core

- [ ] 4.1 Export the block-level parse helper from `srt-parse.ts` (needed to name the unaccounted position) and verify the existing `srt-parse.test.ts` suite stays green afterwards
- [ ] 4.2 Implement the source-integrity check (timing-line count vs parsed count, parser-equivalent tolerance); verify 1.1-1.6 pass
- [ ] 4.3 Implement pass-through predicate (source text contains no letters or digits) as new logic, not a reuse of `isSoundAnnotation`; verify 1.10-1.11 pass
- [ ] 4.4 Implement batching with positional ordinals and `buildBatches`; verify 1.12 and 2.11 pass
- [ ] 4.5 Pin the request/response serialization (explicit shape, anchored per-position parse); verify 3.4 passes on a free-prose reply and 1.8 passes on a well-formed one
- [ ] 4.6 Implement multiset + order verification; verify 3.1-3.5 pass
- [ ] 4.7 Implement halved-retry (depth one, parent half not re-requested) and the no-halving path for single-cue and transport failures; verify 2.12 and 3.10 pass
- [ ] 4.8 Implement the refractory-cue pass-through degradation; verify 2.13 and 3.6 pass
- [ ] 4.9 Implement coverage counting and reporting; verify 2.14 passes
- [ ] 4.10 Implement atomic write (temp sibling + rename + `rmSync` cleanup on failure) following `voiceprint.ts`; verify 3.11 and 3.16 pass
- [ ] 4.11 Implement the advisory length note (never fails a batch) and verify it is recorded in the summary without affecting pass/fail

## 5. Implementation — config refactor and transport

- [ ] 5.1 Extract the env-then-`.env` resolver from `config.ts`, preserving BOTH legs (cwd and package dir); verify 3.17 stays green before touching callers
- [ ] 5.2 Rebuild `loadConfig` on the extracted resolver; verify the full existing suite is green and 3.18 passes
- [ ] 5.3 Add `TRANSLATE_API_KEY`/`TRANSLATE_MODEL`/`TRANSLATE_BASE_URL`/`TRANSLATE_TARGET_LANG` resolution without forcing a transcription key; verify 3.13-3.14 pass
- [ ] 5.4 Add the language-code validation before any path construction; verify 2.9-2.10 pass
- [ ] 5.5 Implement bounded transport retry (status + connection class, `Retry-After`, per-request timeout); verify 3.7-3.9 pass
- [ ] 5.6 Ensure no code path interpolates the key into a thrown message or log line; verify 3.15 passes

## 6. Implementation — CLI surface

- [ ] 6.1 Implement `.srt` discovery (new code — `discover.ts` handles media only and throws `Unsupported file type` for `.srt`); verify 2.4 and 2.3 pass
- [ ] 6.2 Implement output-path derivation (replace final `.srt`, keep backend suffix, case-insensitive); verify 2.1-2.2 pass
- [ ] 6.3 Implement the freshness/skip/override logic; verify 2.5-2.8 pass
- [ ] 6.4 Implement per-file isolation and the success/failure summary with transport-vs-verification classes; verify 3.12 passes
- [ ] 6.5 Register `pi-translate-srt` in `package.json` and add `TRANSLATE_API_KEY` to the env-probe list as `optional: true`; verify `packaging.test.ts` is updated for the three-bin set and passes

## 7. Verification against real data (L2, opt-in)

Requires `TRANSLATE_API_KEY` and the SRT fixture; skipped without them. No existing `qa/` test drives a live third-party API, so this is new opt-in harness — not a default CI job.

- [ ] 7.1 Run the CLI over `~/Movies/2026-08-07 10-01-27.srt` (1325 cues); verify parsed cue count == output cue count, diff output vs input timing values shows zero differences among canonical-separator cues, and record wall-clock and token cost against the ~$0.01 estimate within 5×. (test-plan #P1)
- [ ] 7.3 Run `npm test` and verify the whole suite is green including the parity check
- [ ] 7.4 Run `npm run quality:changed` and verify no new Biome findings

## 8. Manual-only verification (deferred to post-merge)

- [ ] 8.1 Spot-check translation quality on the known Hungarian technical passage (MQTT, TinyPC, Samba, blob store, green/yellow zone) — jargon preserved rather than over-translated, register kept. (test-plan manual-only M1)
- [ ] 8.2 Review the per-file advisory length note on a real run and judge whether flagged cues are genuinely mistranslated or legitimate divergence. (test-plan manual-only M2)

## 9. Close out

- [ ] 9.1 Invoke the `review-code` discipline skill on the diff and resolve findings
- [ ] 9.2 Add `AGENTS.md` rows for the new files following the existing one-row-per-file style with `See change: add-srt-translation-pass`
- [ ] 9.3 Add the bin and `TRANSLATE_*` env rows to `packages/video-transcription/README.md`; verify the documented commands run as written
- [ ] 9.4 Update the `video-transcription` SKILL.md usage section with the new bin and env vars, and warn that `pi-voiceid` throws on a translated SRT rather than skipping it; verify the documented commands run as written
