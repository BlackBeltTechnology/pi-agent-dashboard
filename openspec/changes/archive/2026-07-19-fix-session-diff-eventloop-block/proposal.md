## Why

`GET /api/session-diff` computes git diffs with **synchronous, per-file `git diff` subprocesses on the event loop**. `enrichWithGitDiff` (`packages/server/src/session/session-diff.ts`) calls `git.diffOr({ cwd, path })` — a `spawnSync` via the runner — inside a `files.map(...)` loop, so a session with N changed files runs N synchronous git spawns per diff request. A single very large tracked file makes each spawn read/process huge amounts of data.

Because these are `spawnSync` calls in a request handler, the Node event loop cannot service any other request while they run. Under normal UI polling (multiple browser tabs / reconnects re-requesting the diff), this snowballs into a spawn storm that starves **all** HTTP: `/api/health`, settings, prompt submission, and even static `GET /` hang. WebSocket-cached UI shows stale state, so the dashboard *looks* alive but nothing works. A restart does not fix it durably — the next poll of the heavy session re-triggers the stall.

Field repro (issue #353): a session cwd with ~70 changed files, one a **992 MB staged `.tar`**. `git diff HEAD` against a ~1 GB file per poll pushed the per-file spawn loop over the edge. Diagnosed via SIGUSR1 + CDP CPU profile: `spawn` dominated self-time, JS caller resolved to `enrichWithGitDiff → diffOr → spawnSync`.

The fix infrastructure already exists in-repo: `runAsync()` in `packages/shared/src/platform/runner.ts`, a `SYNTHETIC_DIFF_MAX_BYTES` size cap for untracked/synthetic diffs, and the `session-load-worker-pool.ts` offload pattern.

## What Changes

- **Batch, don't per-file spawn.** Replace the O(files) `git diff HEAD -- <path>` loop with a **single** `git diff --relative HEAD` whose output is split per file on `diff --git` header boundaries. `enrichWithGitDiff` already runs one `git diff --numstat HEAD` for all files — content diff gets the same one-spawn treatment. Per-file synthetic diffs (untracked/new files) stay as-is but are computed from batched detection, not re-spawned.
- **Cap large / binary tracked files.** Introduce `TRACKED_DIFF_MAX_BYTES` (default 5 MB) analogous to the existing `SYNTHETIC_DIFF_MAX_BYTES`. A tracked file whose blob/diff exceeds the cap is listed with its numstat counts but **no** text `gitDiff` (the client already renders a no-diff/binary state). A multi-hundred-MB blob is never fed to `git diff` for rendering.
- **Get it off the event loop.** Make `buildSessionDiff` / `enrichWithGitDiff` async, using `runAsync` (non-blocking spawn) for the git invocations. The route handler at `session-routes.ts` is already `async`, so it awaits the result. No `spawnSync` git call remains on the session-diff request path.
- **Cache + debounce diff results.** Add a short-TTL, per-session in-memory cache keyed by `(sessionId, HEAD sha, dirty-signature)` so repeated UI polls of the same unchanged session return the cached diff instead of recomputing. Concurrent requests for the same session coalesce onto one in-flight computation (single-flight).

## Non-goals

- No change to the changed-file **detection** pipeline (porcelain parse, Bash attribution, ownership gate) — only the **enrichment** (content-diff) step changes.
- No change to the client rendering contract beyond honoring the existing no-`gitDiff` state for capped files.
- No move to `worker_threads` in v1 — `runAsync` (async spawn) already unblocks the loop; the worker pool is a documented fallback path if profiling shows CPU-bound splitting still hurts.

## Capabilities

### Modified Capabilities

- `session-diff-extraction`: the "Optional git diff enrichment" requirement gains an event-loop-safety contract (no `spawnSync` on the request path), a batched single-spawn content-diff contract, a tracked-file size cap, and a result-cache/single-flight contract.

## Impact

- `packages/server/src/session/session-diff.ts` — `enrichWithGitDiff` and `buildSessionDiff` become `async`; per-file `diffOr` loop → one batched `git diff --relative HEAD`; new `TRACKED_DIFF_MAX_BYTES` guard; per-file split helper (`splitBatchedDiff`).
- `packages/shared/src/platform/git.ts` — add an async `diffAllOr` (batched `git diff --relative HEAD`, no path arg) built on `runAsync`; existing sync `diffOr` retained for other callers.
- `packages/server/src/routes/session-routes.ts` — `await buildSessionDiff(...)` (handler already async).
- `packages/server/src/session/` — new small `session-diff-cache.ts` (TTL + single-flight map), owned/disposed alongside the diff route.
- `packages/server/src/session/session-diff.ts.AGENTS.md` + sibling tree rows — update per Documentation Update Protocol.

Rollback considerations:

- Batching + async are internal to the enrichment step; the REST contract shape is unchanged (same `files[].gitDiff` field, now sometimes absent for oversized tracked files — already a valid state).
- `TRACKED_DIFF_MAX_BYTES` is a single constant; raising/lowering it is one line.
- The cache is additive; disabling it (TTL 0) falls back to compute-every-request behavior with the async fix still in place.

## Discipline Skills

- `performance-optimization` — the acceptance criteria carry an explicit latency budget (`/api/health` < 100 ms while a large diff computes); measure-before/after required.
- `systematic-debugging` — reproduce the wedge (many-file + >100 MB-file session) and assert the loop stays responsive before/after.
- `review-code` — async refactor of a hot request path; review the diff before commit.
