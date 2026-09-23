## Why

`/api/session-diff` crashes the dashboard server with `FATAL ERROR: JavaScript heap out of memory` (issue #719: 13 crashes in one log, 11 in one day, at 1.5 / 4.1 / 8.2 GB ceilings). The root cause is **heap retention**, not heap size. Each cached per-file `gitDiff` is a V8 sliced string pointing into the whole-worktree `git diff HEAD` output, so a 92-char diff keeps a 50 MB parent alive (measured: 50.0 MB retained vs 0.0 MB after copying). The result cache limits only its entry count, never its bytes, and each agent tool call mints a new key. So retention grows with `batched-diff size × cached generations`, and no `--max-old-space-size` value is safe. The existing `TRACKED_DIFF_MAX_BYTES` guard gives false assurance: it checks the chunk, but what matters is the parent.

## What Changes

- **D1 (primary):** make each cached tracked-file `gitDiff` an independent copy of its chunk. It must not be a slice of the batched diff. Output stays byte-identical.
- **D2:** give the session-diff result cache a byte budget alongside the existing entry cap. Evict oldest entries until the cache is under both.
- **D4:** release expired cache entries on access. Today they are only released on an over-cap insert.
- **D3 (scoped):** add an opt-in, per-recipe stdout byte limit to the shared async subprocess runner. Overflow kills the child and returns a new typed `output-too-large` error. Only the batched session-diff recipe opts in. When the batched diff exceeds the limit, the session diff degrades to counts only: numstat still works, and no text `gitDiff` is sent for tracked files. A warning is logged that names the cwd and the limit.
- Heap-retention regression tests: a V8-level check that fails today at ~50 MB, plus a cache-budget check.

Not breaking: the REST response shape is unchanged. Other runner callers keep their unbounded behaviour, because the limit is opt-in.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-diff-extraction`: adds a requirement that session-diff memory retention is bounded. Cached entries must hold only their own content, the cache must stay within a byte budget, expired entries must be released, and an oversized batched diff must degrade to counts only.

## Impact

- `packages/server/src/session/session-diff.ts`: copy the renderable chunk before it is stored (`enrichFilesWithContext`).
- `packages/server/src/session/session-diff-cache.ts`: `maxBytes` + `sizeOf` constructor options, byte-aware eviction, expiry on read.
- `packages/server/src/routes/session-routes.ts`: construct the cache with a byte budget and a `SessionDiffResult` size function.
- `packages/shared/src/platform/runner.ts`: optional `Recipe.maxBuffer` and new `ExecError` kind `output-too-large` (async path; the sync path gets `spawnSync` `maxBuffer` parity).
- `packages/shared/src/platform/git.ts`: `GIT_DIFF_ALL` sets `maxBuffer`.
- There is no migration or persisted-state change; the cache is in-memory only. Rollback is a plain revert.
- Compatibility: adding an `ExecError` variant can break exhaustive `switch`es over `error.kind`. Those must be audited.

## Discipline Skills

- `performance-optimization`: this is a memory-retention fix on a hot request path. The tasks measure retained heap before and after, using the issue's reproduction and a heap-level regression test.
- `observability-instrumentation`: the new `output-too-large` degradation path must log a named warning (cwd, limit), so an oversized-diff repo can be diagnosed instead of silently losing diffs.
- `doubt-driven-review`: not run yet. Recommended before apply, because D3 adds a shared `ExecError` variant (a public-ish type change in `packages/shared`).
