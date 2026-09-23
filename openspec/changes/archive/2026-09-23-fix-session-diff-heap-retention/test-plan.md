# Test Plan — fix-session-diff-heap-retention

Stage: design   Generated: 2026-09-22

Requirement refs: `RT` = Cached session diffs do not retain the whole-worktree diff (ADDED) · `GE` = Optional git diff enrichment (MODIFIED) · `CAP` = Tracked-file diff size cap (MODIFIED) · `CA` = Session-diff result cache and single-flight (MODIFIED) · `EL` = Event-loop responsiveness under heavy session diffs (unchanged, must hold).

Fixture vocabulary:
- **retention fixture**: a script run by vitest as a child `node --expose-gc --import tsx <fixture>` (`execFileSync`, `cwd` = repo root, `timeout: 60_000`). It builds a synthetic batched diff inside a function scope, runs the code under test, resets the RegExp last-match statics (`/a/.exec("a")`), calls `gc()` ×3, and prints one JSON line `{ retainedMB }` last. The test parses the last stdout line.
- **temp repo**: `mkdtemp` + `git init`, as in `session-diff-eventloop.test.ts`.
- **cache stats**: new read-only `size` / `totalBytes` getters on `SessionDiffCache`. They are the observable for retention scenarios.
- `B` = cache `maxBytes`; sizes are in `sizeOf` units.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | RT | BVA (retention, fixed path) | L1 | automated | retention fixture: 30 MB single-line `big.txt` chunk + 92-char `small.txt` chunk; `small.txt` is a tracked changed file | `splitBatchedDiff` → `enrichFilesWithContext`; keep only the enriched `small.txt` entry | `retainedMB < 5` |
| E2 | RT | control arm (anti-vacuous) | L1 | automated | same fixture; the held value is `map.get("small.txt").trim()` (old storage form) | same, holding the unflattened slice | `retainedMB > 40`; otherwise fail with "control no longer retains — revisit D1" |
| E3 | RT | EP (N generations) | L1 | automated | retention fixture: 5 distinct 20 MB batched diffs, each with a small tracked file; a `SessionDiffCache` with default budget and `sizeOf` | 5 × `cache.run(key_i, compute_i)`, each compute enriching its own diff | `retainedMB < 10` (not ≈ 100) |
| E4 | RT / GE | EP (byte identity) | L1 | automated | batched diff with chunks: plain edit, rename (`rename to`), CRLF line endings, multi-byte UTF-8 (`é`, emoji), trailing blank lines | `enrichFilesWithContext` | each entry's `gitDiff` `===` `chunk.trim()` of the pre-change split, for every chunk |
| E5 | CA | BVA (budget boundary) | L1 | automated | cache `{ maxBytes: B=100, sizeOf: v => v.n }`; entries of n=40, 40, then n=20 (total 100 = B) | three `run()` inserts | `size === 3`, `totalBytes === 100` (at budget, nothing evicted) |
| E6 | CA | BVA (budget + 1) | L1 | automated | as E5, then insert n=1 (total 101) | 4th `run()` | oldest (n=40) evicted; `size === 3`; `totalBytes === 61` |
| E7 | CA | EP (single over-budget entry) | L1 | automated | B=100; insert a (n=30), then b (n=150) | `run(b)`, then `run(b)` again within TTL | after the first `run(b)`: `size === 1`, a evicted, b kept; second `run(b)` does not call compute (spy count 1) |
| E8 | CA | state-transition (over-budget displaced) | L1 | automated | state after E7 (b cached alone, n=150) | insert c (n=10) | b evicted; `size === 1`; `totalBytes === 10` |
| E9 | CA | state-transition (expiry on access) | L1 | automated | fake timers; TTL 2000; one entry k1 (n=50); `maxEntries` 100 (far from cap) | advance 2001 ms, then `run(k2)` | k1 released: `size === 1` (k2 only), `totalBytes === n(k2)` |
| E10 | CA | EP (accounting on overwrite) | L1 | automated | fake timers; k1 stored (n=50); advance past TTL | `run(k1)` recomputes with n=70 | `size === 1`; `totalBytes === 70` (not 120) |
| E11 | CA | EP (estimate coverage) | L1 | automated | `SessionDiffResult` with `gitDiff` 1000 chars, `changes[0].content` 500 chars, `edits[0].oldText/newText` 100 chars each, an `otherChanges` entry with 300-char `gitDiff` | `sessionDiffResultSize(result)` | `>= 2 × (1000+500+100+100+300)` = 4000; strings reached through nested arrays and objects are all counted |
| E12 | CA | EP (default ctor unchanged) | L1 | automated | `new SessionDiffCache()` (no options), 101 inserts of large values | `run()` ×101 | behaviour identical to today: count-capped at 100 and no byte eviction; existing `session-diff-cache.test.ts` cases stay green |
| E13 | CAP | BVA (runner limit exact) | L1 | automated | recipe `node -e` writing exactly `L = 1 MiB` bytes to stdout; `maxBuffer: L` | `runAsync` | `ok: true`; `value.length === L` |
| E14 | CAP | BVA (runner limit + 1) | L1 | automated | same, writing `L + 1` bytes | `runAsync` | `ok: false`; `error.kind === "output-too-large"`; `error.limitBytes === L`; `typeof error.message === "string"` |
| E15 | CAP | EP (bytes vs UTF-16) | L1 | automated | recipe writes `"é".repeat(600_000)` (1.2 MB of UTF-8, 600k UTF-16 units); `maxBuffer: 1 MiB` | `runAsync` | `output-too-large` (raw bytes counted, not `string.length`) |
| E16 | CAP | EP (opt-in, no regression) | L1 | automated | recipe without `maxBuffer` writing 5 MB | `runAsync` | `ok: true`; full 5 MB returned (unbounded, as today) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | EL / RT | tick-gap threshold | L1 | automated | temp repo with a tracked single-line ~12 MB file modified (batched diff ≈ 24 MB, under the 32 MB limit) plus 50 small modified files; `buildSessionDiff` including D1 flatten + `sizeOf` walk | 10 ms `setInterval` max gap `< 500 ms` (existing budget in `session-diff-eventloop.test.ts`); `ticks > 0` | one full `buildSessionDiff` call |
| P2 | RT / CA | soak (heap flat) | — | manual-only | live dashboard on the issue §4 repro repo (17 MB single-line tracked JSON, modified); an agent session doing 50 edits to other files | `/api/health` `server.heapUsed` after edit 50 ≤ heap after edit 5 + 100 MB; no OOM | 50 tool calls |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | CAP | fault-injection (runaway output) | L1 | automated | child writes stdout forever (`node -e "for(;;)process.stdout.write('x'.repeat(65536))"`); `maxBuffer: 1 MiB`; recipe timeout 15 s | `runAsync` | settles `output-too-large` within 5 s (well before the 15 s timeout); child pid no longer alive within 4 s |
| X2 | CAP | fault-injection (SIGTERM ignored) | L1 | automated | child with `process.on("SIGTERM", () => {})` writing forever; `maxBuffer: 1 MiB` (POSIX only; `it.skipIf(win32)`) | `runAsync` | settles `output-too-large`; child killed by SIGKILL within 3 s + 1 s slack |
| X3 | CAP | fault-injection (settle-once) | L1 | automated | as X1, recipe `parse` is a spy | `runAsync` overflow, then child `close` fires | `parse` spy never called; promise resolved exactly once |
| X4 | GE / CAP | fault-injection (batched diff too large) | L1 | automated | `git.diffAll` mocked → `{ ok:false, error:{ kind:"output-too-large", limitBytes: 32 MiB } }`; numstat mocked with counts for `a.ts`; `new.ts` untracked on disk | `buildGitEnrichmentContext` + `enrichFilesWithContext` for `[a.ts, new.ts]` | `a.ts` has `additions`/`deletions` and no `gitDiff`; `new.ts` has a synthetic `gitDiff`; `console.warn` called once with a message containing the cwd and `33554432` |
| X5 | CAP | state-transition (warn throttle) | L1 | automated | as X4, fake timers; cwd A | enrich A twice at t=0 and t=1 min; enrich cwd B at t=2 min; enrich A at t=10 min + 1 ms | warn count: 1 after both A calls; 2 after B; 3 after A past the window |
| X6 | GE | fault-injection (other git error) | L1 | automated | `git.diffAll` mocked → `{ ok:false, error:{ kind:"exit", code:128 } }` | enrich `[a.ts]` | `a.ts` has no `gitDiff`; no `[session-diff]` warning (current fallback kept) |
| X7 | GE | EP (mock-migration guard) | L1 | automated | migrated `vi.mock` of `git.diffAll` resolving `{ ok:true, value:<batched diff with a.ts chunk> }` | `buildSessionDiff` on a tracked changed `a.ts` | `a.ts.gitDiff` is defined and equals the chunk. Guards against a rename-only migration that silently empties the diff map |
| X8 | GE / CAP | fault-injection (real oversized repo) | L1 | automated | temp repo: tracked single-line 17 MB JSON committed then modified (batched diff ≈ 34 MB > 32 MB); one small tracked edit `s.txt` | `buildSessionDiff([], repo)` | `isGitRepo === true`; the JSON entry and `s.txt` have numstat counts and no `gitDiff`; one warning logged |
| X9 | CAP | compile gate (new `ExecError` variant) | ci | automated | `ExecError` union with `output-too-large` (carrying `message`); `openspec-routes.ts` narrowing chain ending in `err.message` | existing CI step `pnpm run lint` (`tsc --noEmit`) | exits 0 |

---

## Coverage summary

- Requirements covered: 5/5 (RT, GE, CAP, CA, EL)
- Scenarios by class: edge 16 · perf 2 · frontend 0 · error 9
- Scenarios by level: L1 25 · ci 1 · — 1
- Scenarios by disposition: automated 26 · manual-only 1

## New infra needed

- none. The retention fixture is a child-process script inside the existing vitest suite; `SessionDiffCache` gains read-only `size`/`totalBytes` getters as its test observable.
