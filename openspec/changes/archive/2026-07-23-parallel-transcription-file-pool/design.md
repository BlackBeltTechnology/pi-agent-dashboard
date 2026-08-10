## Context

`run.ts` is the only orchestration layer. Today:

```
resolveInputs → filter isTranscribed → for (file of toProcess) { await processFile }
```

`processFile` per file: extract audio (video only) → `transcribeChunked` → `saveSrt`.
The wall-clock cost is `SonioxClient.waitForCompletion` (2 s poll loop, server-side work).
This design overlaps those waits with a file-level pool. `soniox.ts` / `chunk.ts` stay
serial and untouched.

## Goals / Non-Goals

**Goals**
- Overlap the per-file Soniox wait across up to N files.
- Preserve: per-file error isolation, idempotency filter, oldest-first dispatch, summary
  counts, identical SRT output.
- Keep the change inside `run.ts` + `config.ts` (+ tests).

**Non-Goals**
- No chunk-level parallelism (one long recording still transcribes its chunks serially).
- No global cross-layer semaphore, no retry/backoff machinery (unneeded at N ≤ 100 vs the
  100-pending Soniox cap), no streaming upload rewrite.
- No transcription-record cleanup (a pre-existing latent gap toward the 2000-total cap —
  out of scope, noted for a future change).

## Decisions

### Pool primitive: hand-rolled fixed-width worker pool (no new dependency)

A ~15-line pool over a shared cursor. N worker promises each loop: atomically take the next
index, `await processFile`, record the outcome, repeat until the cursor is exhausted.
`await Promise.all(workers)`.

```
let cursor = 0;
async function worker() {
  while (true) {
    const i = cursor++;            // cooperative; single-threaded, no lock needed
    if (i >= toProcess.length) return;
    const file = toProcess[i];
    deps.log(`start  ${file}`);
    try {
      const outcome = await processFile(file, service, cfg, ffmpegOk, deps);
      // increment already / succeeded per outcome
      deps.log(`done   ${file}`);
    } catch (err) {
      failed++; deps.error(`failed ${file}: ${msg}`);
    }
  }
}
await Promise.all(Array.from({ length: n }, worker));
```

- **Alternative rejected:** `p-limit` / `p-map` dependency — overkill for a single call
  site and adds a runtime dep to a package whose only runtime dep today is
  `@blackbelt-technology/pi-dashboard-shared`. Simplicity-first (AGENTS.md rule 2).
- **Why a cursor, not `splice`/chunked slices:** the cursor gives oldest-first dispatch for
  free and naturally load-balances (a slow file doesn't stall a whole pre-assigned slice).

### Counter safety

Node runs JS on one thread; `cursor++` and the counter increments are never preempted
mid-statement, so there is **no data race** — only interleaving at `await` points. Each
worker mutates shared `succeeded/already/failed` between awaits. This is safe, but the
settle/increment mapping is exactly what the regression test pins (N=1 vs N=4 must yield
identical totals for the same fixtures).

### Default concurrency = 8, clamp [1, 100]

| Constraint | Head-room at N=8 |
|---|---|
| Soniox pending cap = 100 | 8 ≪ 100 — never approached |
| Soniox total cap = 2000 | unaffected by width (about run count) |
| Client RAM (`uploadFile` readFileSync) | short files ~ a few MB × 8 = tens of MB — trivial |
| ffmpeg CPU (video extract) | 8 concurrent short extractions fine on modern cores |

`8` is a real "increase" over today's implicit serial (=1) while staying conservative on
RAM/CPU. Upper clamp `100` aligns with the Soniox pending ceiling so a user can push it but
never configure past what the API tolerates. `parseConcurrency`: `Number.parseInt`, require
finite integer ≥ 1, else default; then `Math.min(value, 100)`.

### Ordering semantics

The existing spec says files are "processed oldest-first by modification time." With a pool
that guarantee is refined to **dispatch order**: workers claim indices in ascending order,
so files *start* oldest-first, but *completion* order is nondeterministic for N > 1. The SRT
output per file is independent of processing order, so observable results are unchanged; only
the removed serial-completion assumption (and the old `[i/n]` counter) is affected. The spec
requirement is MODIFIED to state dispatch-order rather than completion-order.

### Progress output

Serial `[i/n] Processing: X` implied a single in-flight file. Under a pool it is replaced by
per-file `start` / `done` / `failed` lines that each name their file, so interleaved output
stays attributable. The final `=== Transcription Summary ===` block is unchanged.

## Risks / Trade-offs

- **Nondeterministic log order** — accepted; each line self-identifies its file. Tests assert
  on the summary + presence of per-file markers, not on line order.
- **A single very large file in a mostly-short batch** holds one worker for the whole batch
  while others drain — acceptable; the cursor keeps the other N-1 workers busy.
- **N=1 must stay a faithful serial path** for the regression baseline — covered by a test
  asserting identical totals and (at N=1) deterministic completion order.

## Migration

None. New env var is optional with a default; absent config behaves like `TRANSCRIBE_CONCURRENCY=8`.
Set `TRANSCRIBE_CONCURRENCY=1` to restore exact legacy serial behavior.
