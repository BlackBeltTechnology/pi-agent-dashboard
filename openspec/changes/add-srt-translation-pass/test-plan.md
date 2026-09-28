# Test Plan — add-srt-translation-pass

Stage: apply (tasks.md present)   Generated: 2026-09-21

## ⚠ Clarifications needed (2)

- [ ] **C1** — Request timeout: X9 asserts a hung endpoint does not stall the run, but the spec fixes no bound. What timeout should a single translation request enforce — 60s, 120s, or a value derived from batch size? Without a number the "does not stall" observable cannot be measured.
- [ ] **C2** — Transport attempt bound: X8 asserts abandonment after the attempt bound, but the spec fixes no count. How many transport attempts before a batch is declared a transport failure — 3, 4, or matching `assemblyai.ts`'s existing bound?

> Both are numeric knobs with sane defaults; they do not block the remaining scenarios.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Source integrity | EP (nominal) | L1 | automated | canonical `talk.srt`, 4 cues, 4 timing lines | integrity check runs | parsed cue count 4 == timing-line count 4; proceeds |
| E2 | Source integrity | BVA / fused-cue | L1 | automated | one blank-line block containing TWO timing lines then text | integrity check runs | timing lines 2 != parsed 1; file aborts naming both counts and the unaccounted position |
| E3 | Source integrity | tolerance superset | L1 | automated | same 4-cue file as CRLF + BOM + whitespace-only separator | integrity check runs | counts equal; file accepted, no false abort |
| E4 | Source integrity | empty input | L1 | automated | zero-byte `.srt` | run starts | error reported; no output file created |
| E5 | Source integrity | invalid input | L1 | automated | non-empty text file with zero `-->` lines | run starts | error reported; no output file created |
| E6 | Source integrity | missing index | L1 | automated | 3 cues, no index lines | integrity + translate | 3 cues parsed, integrity passes, indexes synthesised and reported |
| E7 | Preserved timing | equivalence class | L1 | automated | source using `.` as ms separator | translate | output uses `,`; start/end ms values byte-equal numerically; normalisation reported as a note |
| E8 | Preserved timing | invariant | L1 | automated | 4-cue fixture, stub backend | translate | output cue count 4; each start/end ms equal to input; order unchanged |
| E9 | Label preserved | decision | L1 | automated | cue text `[Speaker 2] hello there` | translate | output begins `[Speaker 2]`; captured request payload contains no `Speaker` substring |
| E10 | Pass-through | equivalence class | L1 | automated | cue whose text is exactly `[music]` | translate | emitted unchanged; counted in total; absent from request payload |
| E11 | Pass-through | equivalence class | L1 | automated | cue whose text is only `♪ ♪` (no letters/digits) | translate | emitted unchanged; counted; absent from request payload |
| E12 | Positional ids | invariant | L1 | automated | source where a synthesised index collides with a later explicit index | translate | wire ids are ordinals 0..N-1, all distinct; no id collision possible |
| E13 | Sibling naming | decision table | L1 | automated | `talk.diarize.srt`, target `en` | resolve output path | `talk.diarize.en.srt` |
| E14 | Sibling naming | decision table | L1 | automated | `talk.srt` and `talk.diarize.srt` both present | resolve output paths | `talk.en.srt` and `talk.diarize.en.srt`; neither path equals the other |
| E15 | Sibling naming | case-insensitivity | L1 | automated | `TALK.SRT` | discovery | recognised as a subtitle; output is `TALK.en.srt` |
| E16 | Sibling naming | exclusion | L1 | automated | `talk.srt`, `talk.de.srt`, `talk.en.srt` | discovery with target `en` | only `talk.srt` is a source; the two translations are reported skipped |
| E17 | Freshness | state transition | L1 | automated | output mtime > source mtime, stub backend | run | file skipped; zero backend calls recorded |
| E18 | Freshness | boundary | L1 | automated | output mtime == source mtime | run | file skipped as up to date |
| E19 | Freshness | state transition | L1 | automated | source mtime > output mtime | run | file re-translated; output overwritten |
| E20 | Freshness | override | L1 | automated | output newer than source, override requested | run | file translated regardless; backend called once |
| E21 | Lang validation | invalid input | L1 | automated | `TRANSLATE_TARGET_LANG=../x` | run starts | run fails naming the value; no path constructed (assert no `fs` path call observed) |
| E22 | Lang validation | decision table | L1 | automated | unset / `en` / `hu` / `pt-BR` / `EN` | run starts | unset→`en` used; valid forms accepted; `EN` and `pt-BR` resolved per the stated pattern |
| E23 | Batching | partition | L1 | automated | 97 cues, batch size 40 | buildBatches | batches of 40/40/17; union of ordinals == 0..96 with no loss or duplicate |
| E24 | Retry | boundary | L1 | automated | batch of exactly 1 cue, backend rejects it twice | translate | retried once unchanged, not halved to an invalid size; file then fails |
| E25 | Refractory cue | degradation | L1 | automated | one substantive cue returns blank on both attempts; others succeed | translate | that cue emits its SOURCE text unchanged and is reported; file succeeds; other cues translated |
| E26 | Coverage report | invariant | L1 | automated | 4 cues: 2 translated, 2 passed through | run | report states translated 2 + passed 2 == source 4 |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Total-cue-count | fault-injection | L1 | automated | reply omits position 2 of 3 | batch verifies | batch halved and retried; retry also omits; file fails naming position 2 |
| X2 | Total-cue-count | fault-injection | L1 | automated | reply contains position 1 twice, omits 2 | multiset check | duplicate detected by per-position count; follows retry-then-fail |
| X3 | Total-cue-count | fault-injection | L1 | automated | reply contains position 77 (never sent) | multiset check | unsent position detected; follows retry-then-fail |
| X4 | Total-cue-count | fault-injection | L1 | automated | reply is free prose with no parseable positions | parse | batch fails; follows retry-then-fail; no guessing applied |
| X5 | Total-cue-count | fault-injection | L1 | automated | reply returns positions 0,1,2 as 2,0,1 | order check | out-of-order detected; follows retry-then-fail |
| X6 | Total-cue-count | fault-injection | L1 | automated | substantive cue returns whitespace-only text | verification | batch fails, then refractory rule (E25) applies on retry |
| X7 | Transport recovery | fault-injection (status) | L1 | automated | 429 with `Retry-After: 2`, then success | request | retried after the hint; final result succeeds |
| X8 | Transport recovery | fault-injection (abort) | L1 | automated | connection reset on every attempt | request | retried to the attempt bound, then declared a TRANSPORT failure ([NEEDS CLARIFICATION: C2 — attempt count]) |
| X9 | Transport recovery | fault-injection (delay) | L1 | automated | endpoint accepts connection, never responds | request | request times out ([NEEDS CLARIFICATION: C1 — timeout value]); next batch still processed; run does not stall |
| X10 | Retry layering | decision table | L1 | automated | transport attempts exhausted on a batch | batch resolves | classified transport failure; halving path NOT entered; zero half-requests sent |
| X11 | No partial output | fault-injection | L1 | automated | pre-existing `talk.en.srt` present; a later batch fails | run | pre-existing file byte-identical after run; no new file written; no orphan `.tmp` sibling remains |
| X12 | Per-file isolation | fault-injection | L1 | automated | 3 files, middle one fails | run | files 1 and 3 written correctly; summary lists 2 successes and 1 failure separately |
| X13 | Configuration | fault-injection | L1 | automated | no credential set, 1 file needing translation | run | fails before any request; message names the env var |
| X14 | Configuration | boundary | L1 | automated | no credential set, all outputs up to date | run | exits successfully reporting skips; zero credential lookups required |
| X15 | Configuration | leakage | L1 | automated | backend returns an auth error echoing the request | error reporting | reported message contains no substring of the API key |
| X16 | Atomic write | fault-injection | L1 | automated | write fails mid-way (simulated ENOENT/ENOSPC) | run | temp sibling removed; target path untouched; no orphan file |
| X17 | Config refactor | regression | L1 | automated | existing `config.test.ts` cases, unchanged | suite | all pre-existing assertions pass with identical messages and precedence (env → cwd `.env` → packageDir `.env`) |
| X18 | Config `.env` legs | decision table | L1 | automated | key present only in cwd `.env`; then only in package `.env` | resolve | found in both cases; absent from both → fails naming the var |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Coverage on real corpus | throughput + cost | L2 | automated | `~/Movies/2026-08-07 10-01-27.srt`, 1325 cues, real backend | completes with parsed==output cue count; wall-clock recorded; token cost within 5× of the ~$0.01 estimate | single run |

### Manual-only

| id | requirement | technique | level | disposition | surface | human looks for | expected |
|----|-------------|-----------|-------|-------------|---------|-----------------|----------|
| M1 | Translation quality | subjective | — | manual-only | known Hungarian technical passage (MQTT, TinyPC, Samba, blob store, green/yellow zone) from the spike | jargon preserved rather than over-translated; technical register kept | [judgment: readability and terminology correctness have no automatable observable] |
| M2 | Advisory length note | subjective | — | manual-only | the per-file length note emitted on a real run | whether flagged cues are genuinely mistranslated or legitimate divergence | [judgment: note usefulness is a human call] |

---

## Coverage summary

- Requirements covered: 7/7
- Scenarios by class: edge 26 · error 18 · perf 1 · manual-only 2
- Scenarios by level: L1 44 · L2 1 · L3 0 · manual-only 2
- Scenarios by disposition: automated 45 · manual-only 2

## New infra needed

- **L2 harness for P1** — no existing `qa/` test drives a transcription-adjacent CLI against a live third-party API with a real credential. P1 is therefore opt-in (skipped without `TRANSLATE_API_KEY` + Soniox SRT fixture present), not a default CI job. Flagged rather than assumed.
- No L3/e2e tier applies: this change has no rendered UI.
- No new vitest harness needed; L1 scenarios extend the existing `packages/video-transcription/src/__tests__/` tier, with the injected-`fetch` stub as the fault-injection seam.
