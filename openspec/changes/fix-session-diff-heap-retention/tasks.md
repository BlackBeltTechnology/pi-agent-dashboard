## 1. D1: break the sliced-string retention (primary fix)

- [ ] 1.1 Add a heap-retention regression test in `packages/server/src/session/__tests__/` (expose `gc` via `v8.setFlagsFromString` + `vm.runInNewContext`). Build a 50 MB batched diff containing a small file, run it through `splitBatchedDiff` + `enrichFilesWithContext`, drop every other reference, and assert retained heap < 5 MB. Verify the test FAILS on the current code (~50 MB).
- [ ] 1.2 Add `flattenString` (Buffer round-trip, with a warning comment) in `session-diff.ts`, and store `gitDiff: flattenString(chunk.trim())` at the renderable-chunk site. Verify 1.1 passes and the existing session-diff tests still pass (output byte-identical).

## 2. D2 + D4: byte-bounded cache with expiry on read

- [ ] 2.1 Extend `session-diff-cache` tests: (a) entries whose combined `sizeOf` exceeds `maxBytes` evict oldest-first until within budget; (b) a single over-budget entry is returned but not retained; (c) an expired entry is released on the next `run()` even below `maxEntries`; (d) single-flight still coalesces. Verify they fail first.
- [ ] 2.2 Implement the `{ maxBytes, sizeOf }` options, `totalBytes` bookkeeping (on set, delete, `clear`), byte-aware eviction, and the expired sweep on `run()` in `session-diff-cache.ts`. Verify 2.1 passes.
- [ ] 2.3 Add `sessionDiffResultSize()` (≈ 2 × Σ `gitDiff.length` over owned + other files + a constant) and wire `new SessionDiffCache(…, { maxBytes: 64 MB, sizeOf })` in `routes/session-routes.ts`. Verify with a unit test of the size function and the existing session-routes tests.

## 3. D3: bounded batched-diff output

- [ ] 3.1 Runner tests in `packages/shared`: a recipe with `maxBuffer` whose child writes more than the limit settles with `{ kind: "output-too-large", limitBytes }`, and the child is killed. A recipe without `maxBuffer` is unchanged. Verify they fail first.
- [ ] 3.2 Add `Recipe.maxBuffer`, `RunCtx.maxBuffer`, and the `ExecError` variant `output-too-large`. Enforce the limit in `runAsync` (stop appending, SIGTERM→SIGKILL) and map `spawnSync` `maxBuffer`/`ENOBUFS` in `run`. Verify 3.1 passes.
- [ ] 3.3 Audit exhaustive handling of `ExecError.kind` (`grep -rn "error.kind\|\.kind ===" packages/*/src`) and run the workspace `tsc --noEmit`. Verify there are no type errors.
- [ ] 3.4 Set `GIT_DIFF_ALL.maxBuffer = 32 MB`. In `buildGitEnrichmentContext`, call `diffAll`, and on `output-too-large` log the `[session-diff]` warning (cwd, limit) and continue with an empty diff map. Add a test: a stubbed oversized diff yields entries with numstat counts, no `gitDiff`, and one warning.

## 4. Verification

- [ ] 4.1 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and verify it is green.
- [ ] 4.2 Manual check of the issue's §4 reproduction (single-line 17 MB tracked JSON, modified): restart the server, poll `/api/session-diff` across repeated agent edits, and verify `/api/health` `server.heapUsed` stays flat (does not grow by the batched-diff size per tool call). Verify the warning log appears when the diff is over 32 MB.
- [ ] 4.3 Update the `AGENTS.md` rows for `session-diff.ts`, `session-diff-cache.ts`, `runner.ts`, and `git.ts` with `See change: fix-session-diff-heap-retention`.
