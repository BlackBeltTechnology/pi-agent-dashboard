## Why

`/api/session-diff` crashes the dashboard server with `FATAL ERROR: JavaScript heap out of memory` (issue #719: 13 crashes in one log, 11 in one day, at 1.5 / 4.1 / 8.2 GB ceilings). The root cause is **heap retention**, not heap size. Each cached per-file `gitDiff` is a V8 sliced string pointing into the whole-worktree `git diff HEAD` output, so a 92-char diff keeps a 50 MB parent alive (measured: 50.0 MB retained vs 0.0 MB after copying). The result cache limits only its entry count, never its bytes, and each agent tool call mints a new key. So retention grows with `batched-diff size × cached generations`, and no `--max-old-space-size` value is safe. The existing `TRACKED_DIFF_MAX_BYTES` guard gives false assurance: it checks the chunk, but what matters is the parent.

## What Changes

- **D1 (primary):** make each cached tracked-file `gitDiff` an independent copy of its chunk. It must not be a slice of the batched diff. Output stays byte-identical.
- **D2:** give the session-diff result cache a byte budget, estimated over each result's full serialized size, alongside the existing entry cap. Evict oldest entries until the cache is under both. The newest entry is always kept, so large sessions still cache.
- **D4:** release expired cache entries on access. Today they are only released on an over-cap insert.
- **D3 (scoped):** add an opt-in, per-recipe output byte limit to the shared **async** subprocess runner. The sync path is unchanged. Overflow kills the child and returns a new typed `output-too-large` error. Only the batched session-diff recipe opts in (32 MB). When the batched diff exceeds the limit, the session diff degrades to counts only: numstat still works, tracked files get no text `gitDiff`, and untracked synthetic diffs are kept. A warning naming the cwd and the limit is logged, throttled per cwd.
- Heap-retention regression tests: a V8-level check in a child `--expose-gc` process that fails today at ~50 MB, plus cache-budget, runner and degradation tests.

Not breaking: the REST response shape is unchanged. Other runner callers (sync and async) keep today's behaviour, because the limit is opt-in per recipe. Behaviour change: in repos whose whole-worktree diff exceeds 32 MB, tracked files show counts without text diffs. Today such repos crash the server.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-diff-extraction`: ADDS "Cached session diffs do not retain the whole-worktree diff". MODIFIES "Optional git diff enrichment" and "Tracked-file diff size cap" to add the batched-diff output limit, counts-only degradation, and the throttled warning; the previously unconditional "gitDiff present" scenarios gain a within-limit condition. MODIFIES "Session-diff result cache and single-flight" to add the shared byte budget, the newest-entry guarantee, and expiry on access; TTL cache-hit scenarios become conditional on no intervening eviction.

## Impact

- `packages/server/src/session/session-diff.ts`: copy the renderable chunk before it is stored (`enrichFilesWithContext`).
- `packages/server/src/session/session-diff-cache.ts`: `maxBytes` + `sizeOf` constructor options, byte-aware eviction, expiry on read.
- `packages/server/src/routes/session-routes.ts`: construct the cache with a byte budget and a `SessionDiffResult` size function.
- `packages/shared/src/platform/runner.ts`: optional `Recipe.maxBuffer` and new `ExecError` kind `output-too-large`, enforced in `runAsync` only. The shared `terminate()` escalation is reused by the timeout and overflow paths.
- `packages/shared/src/platform/git.ts`: `GIT_DIFF_ALL` sets `maxBuffer`.
- `packages/server/src/__tests__/session-diff.test.ts`: `diffAllOr` mocks migrate to `diffAll`.
- There is no migration or persisted-state change; the cache is in-memory only. Rollback is a plain revert.
- Compatibility: a new `ExecError` variant. No exhaustive `switch` over `kind` exists today, and `*Or` helpers treat it like any other error; the workspace `tsc` confirms this.

## Discipline Skills

- `performance-optimization`: this is a memory-retention fix on a hot request path. The tasks measure retained heap before and after, using the issue's reproduction and a heap-level regression test.
- `observability-instrumentation`: the new `output-too-large` degradation path must log a named warning (cwd, limit), so an oversized-diff repo can be diagnosed instead of silently losing diffs.
- `doubt-driven-review`: ran at planning in one cycle, with a single-model reviewer plus a cross-model reviewer on `@propose-review-1`. It turned the spec delta into MODIFIED requirements, exposed the V8 RegExp last-match pin (verified; the test now neutralises it), switched `sizeOf` to a serialized-size estimate, added the newest-entry guarantee, dropped the sync-path and `RunCtx` scope, and routed D3 through `diffAll` so the error is not swallowed. Cycle 2 made the cache requirement MODIFIED, replaced the `JSON.stringify` size estimate with an allocation-free walk, gave `output-too-large` a `message` (`openspec-routes.ts` narrowing), counted raw stdout bytes, and documented the pre-existing `otherChanges` size as out of scope.
