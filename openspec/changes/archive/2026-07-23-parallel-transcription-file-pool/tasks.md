## 1. Concurrency config

- [x] 1.1 Add `concurrency: number` to the `Config` interface in
      `packages/video-transcription/src/config.ts`.
- [x] 1.2 Add `DEFAULT_CONCURRENCY = 8` and a `parseConcurrency(raw, fallback)` helper:
      `Number.parseInt` base 10, accept finite integer ≥ 1 else fallback, then clamp with
      `Math.min(value, 100)` (100 = Soniox pending-job cap).
- [x] 1.3 In `loadConfig`, read `env.TRANSCRIBE_CONCURRENCY` via `parseConcurrency` and set
      `concurrency` on the returned `Config`.

## 2. File-level worker pool in run.ts

- [x] 2.1 Replace the serial `for` loop in `run(...)`
      (`packages/video-transcription/src/run.ts`) with a fixed-width worker pool: a shared
      `cursor` index, `n = cfg.concurrency` worker functions that claim `cursor++`, run
      `processFile`, and record the outcome until the cursor exhausts `toProcess`; then
      `await Promise.all(workers)`.
- [x] 2.2 Preserve per-file `try/catch` and the `succeeded` / `already` / `failed` counters
      (incremented as each file settles). Keep the up-front `isTranscribed` filter and the
      "Found N files: X to process, Y already transcribed" line unchanged.
- [x] 2.3 Replace the `[i/n] Processing: <file>` line with per-file start + done/failed
      lines that each name the file (concurrency-safe, attributable when interleaved). Leave
      the final `=== Transcription Summary ===` block unchanged.
- [x] 2.4 Ensure `concurrency === 1` yields serial, deterministic completion order
      (single worker) — the legacy-behavior fallback.

## 3. Tests

- [x] 3.1 `config.test.ts`: `TRANSCRIBE_CONCURRENCY` unset → `concurrency === 8`; `"4"` → 4;
      `"0"` / `"-2"` / `"abc"` → 8 (default); `"250"` → clamped to 100; `"3.9"` → 3.
- [x] 3.2 `run.test.ts`: with a mocked `transcribe` dep and 6 fixture files, a batch at
      `concurrency=4` and the same batch at `concurrency=1` produce **identical**
      `RunSummary` totals (total / already / newlyTranscribed / failed).
- [x] 3.3 `run.test.ts`: concurrency is actually exercised — instrument the mocked
      `transcribe`/`processFile` to record peak simultaneous in-flight count and assert it
      reaches `min(concurrency, fileCount)` (e.g. resolve on a shared gate) and never exceeds
      `concurrency`.
- [x] 3.4 `run.test.ts`: a single failing file (mock throws) is counted in `failed` and does
      NOT abort the other files in the pool (they still complete/count).
- [x] 3.5 `run.test.ts`: `concurrency=1` preserves oldest-first **completion** order
      (assert the order the mock observed matches the dispatch order).

## 4. Docs

- [x] 4.1 Add `TRANSCRIBE_CONCURRENCY` to the env-override table and prose in
      `.pi/skills/video-transcription/SKILL.md` (default 8, range 1–100, "parallel files").
- [x] 4.2 Mirror the env var in `packages/video-transcription/README.md` if it documents the
      other env vars.
- [x] 4.3 Update the `packages/video-transcription/AGENTS.md` row for `run.ts` / `config.ts`
      only if their one-line purpose changes materially (pool + concurrency config).

## 5. Verify

- [x] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` → `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`
      clean (scope to the video-transcription package if iterating). — 68/68 pass; tsc + biome clean.
- [x] 5.2 Manual: run `pi-transcribe` on a directory of ≥ 8 short untranscribed files and
      confirm files start in overlapping fashion (interleaved start lines), all SRTs are
      written, and the summary counts match; then rerun and confirm idempotent skip.
      — DEFERRED: to be verified live (needs SONIOX_API_KEY + media); owner will test later.
- [x] 5.3 Manual: `TRANSCRIBE_CONCURRENCY=1 pi-transcribe <dir>` reproduces serial behavior.
      — DEFERRED: to be verified live alongside 5.2.
- [x] 5.4 `openspec validate parallel-transcription-file-pool --strict`. — valid.
