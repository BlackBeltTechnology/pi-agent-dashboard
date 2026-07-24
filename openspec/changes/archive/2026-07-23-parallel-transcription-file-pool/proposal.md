## Why

`pi-transcribe` processes files strictly one at a time. `run.ts` drives a serial
`for` loop over `toProcess`, `await`ing `processFile` before starting the next. Each
file's wall-clock time is dominated by `SonioxClient.waitForCompletion` — a poll loop
that sleeps 2 s and re-checks status for up to 60 min while Soniox does the work
server-side. That idle polling is paid **once per file, in series**, so a batch of N
short files takes ≈ N × (upload + server-side transcribe + poll) even though the local
process is doing nothing but waiting.

The workload this package actually serves is **many short recordings** (Google Recorder
`.m4a` exports, meeting clips). For that shape the work is I/O-bound on a remote API, not
CPU-bound locally — the textbook case where overlapping the waits gives near-linear
speedup on a single Node thread.

The Soniox async API imposes **no low concurrency cap**: the binding limits are **100
pending transcriptions** and **2000 total** per account (verified against
`docs/stt/async/limits-and-quotas`). A modest file-level pool is nowhere near those
ceilings; the real client-side ceiling is RAM (`SonioxClient.uploadFile` reads the whole
file into memory) and ffmpeg CPU for video extraction — both trivial for short files at a
single-digit pool width.

## What Changes

Replace the serial per-file loop in `run.ts` with a **bounded-concurrency worker pool** at
the **file level**. At most `TRANSCRIBE_CONCURRENCY` files are in flight at once; each file
still runs its existing `processFile` (extract → chunk → Soniox → save SRT) unchanged.

- **`config.ts` gains `concurrency`**, parsed from a new `TRANSCRIBE_CONCURRENCY` env var.
  Positive integer, **default `8`**, clamped to `[1, 100]` (100 = Soniox's pending-job
  cap). Invalid/absent → default. Follows the existing `MAX_CHUNK_HOURS` / `MAX_AUDIO_MB`
  env pattern.
- **`run.ts` replaces the serial `for` with a fixed-width pool.** N workers pull from a
  shared cursor over `toProcess`, so files are **dispatched oldest-first** (preserving the
  discovery order guarantee at dispatch) but **complete concurrently**. Per-file
  `try/catch` and outcome counting are preserved; counters are incremented as each file
  settles.
- **Progress output becomes concurrency-safe.** The `[i/n] Processing: <file>` line (which
  would interleave into mush under parallelism) is replaced with per-file **start** and
  **done/failed** lines that each name their file, plus the unchanged final summary.
- **`concurrency === 1` reproduces today's behavior** (serial, deterministic completion
  order) — a safe fallback and the basis for a regression test.

Explicitly **out of scope**: `soniox.ts` and `chunk.ts` are untouched. Chunk-level
processing within a single long recording stays serial — irrelevant to the short-file
workload and avoiding a global cross-layer semaphore keeps the change surgical.

## Impact

- Affected specs: `video-transcription` (one ADDED requirement for the concurrency pool;
  MODIFIED discovery-ordering and configuration requirements).
- Affected code: `packages/video-transcription/src/run.ts`, `src/config.ts` (+ their tests).
  `soniox.ts`, `chunk.ts`, `discover.ts`, `ffmpeg.ts` unchanged.
- Behavior: N× throughput on batches of ≥ N files; identical output SRT content. No CLI
  argument or skill trigger changes. New optional `TRANSCRIBE_CONCURRENCY` env var
  documented in the skill README + env table.
- Risk: bounded pool correctness (counter/settle races on Node's single thread are
  cooperative, not preemptive — no data race, but the settle/increment logic needs a
  focused test). Completion order is no longer deterministic for N > 1; anything relying on
  serial completion (only the progress log) is adjusted.

## Discipline Skills

- `performance-optimization` — throughput change with a measurable before/after; keep the
  measure-first discipline (baseline serial vs pooled on a fixed batch).
- `observability-instrumentation` — the progress-reporting rework (per-file start/done
  lines, in-flight visibility) must stay legible under concurrency.
