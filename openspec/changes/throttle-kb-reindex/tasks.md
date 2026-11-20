## 1. Measure (performance-optimization — before any change)

- [ ] 1.1 Add `packages/kb/src/__tests__/helpers/` corpus builder (≥3k markdown files, ~50k chunks) and a script `packages/kb/scripts/measure-reindex.ts` (or test with `KB_MEASURE=1`) that runs a forced `indexSource` under `withEventLoopLag` (`helpers/event-loop-lag.ts`) and prints max/p99 lag, wall ms, commit count. Verify: runs on current code.
- [ ] 1.2 Record the **baseline** numbers in `design.md` (`## Measurements`). Verify: baseline shows lag well above 250 ms (else re-check the premise). Target for the whole change: main-thread lag ≤ 200 ms on the ~50k-chunk corpus.

## 2. Engine fingerprint (TDD)

- [ ] 2.1 Test (fail first) in `packages/kb/src/__tests__/engine-fingerprint.test.ts`: `computeRowsHash` unchanged after editing a non-row file, changed after editing `chunker.ts`/`indexer.ts`/`adoc-chunker.ts`/`frontmatter.ts`/`gitignore.ts` in a sandbox pkg; `writeFingerprint` emits `rowsHash`.
- [ ] 2.2 Test (fail first) in `index-integrity-gate.test.ts`: `runningEngine()` reads `rowsHash`; JSON without it ⇒ `null`; non-row edit ⇒ `sourceGateIsStale` false.
- [ ] 2.3 Guard test (fail first) `engine-row-closure.test.ts`: static import closure of `src/indexer.ts` ⊆ allowlist ∪ {`types.ts`, `sqlite-store.ts`, `config.ts`}; failing message names the offending module.
- [ ] 2.4 Implement `computeRowsHash` + `ROW_PRODUCING_FILES` in `packages/kb/bin/lib/engine-fingerprint.mjs`; add `rowsHash` to `fingerprintPackage`; re-export via `scripts/lib/kb-engine-fingerprint.mjs`; make `scripts/check-kb-dist-fresh.mjs` fail when `rowsHash` is missing.
- [ ] 2.5 `packages/kb/src/index-gate.ts`: `runningEngine()` reads `rowsHash` (update doc comment). Verify 2.1–2.3 green.

## 3. Time-bounded batches (TDD)

- [ ] 3.1 Test (fail first) `index-batch-budget.test.ts`: fake clock (`vi.spyOn(performance, 'now')`) — budget elapsing before 100 files commits+yields early; row set identical to count-only batching.
- [ ] 3.2 Test (fail first): forced pass on the 1.1 corpus (reduced size) under `withEventLoopLag` ⇒ max delay ≤ 250 ms.
- [ ] 3.3 Implement `INDEX_BATCH_MAX_MS = 50` + `lastYield` in the `indexer.ts` batch loop (`indexer.ts:176-199`). Verify 3.1–3.2 green; existing `walk-yield.test.ts`, `index-atomicity.test.ts` still green.
- [ ] 3.4 Re-measure with 1.1; record **after** numbers in `design.md`. Verify: lag reduced; wall-time regression ≤ 15 % (else raise budget). In-process lag may stay > 200 ms — expected; section 5 closes the gap with the worker.

## 5. kb worker (TDD; D3 confirmed (owner, 2026-11-20))

- [ ] 5.1 **Spike (no production code):** minimal `.mjs` worker importing `@blackbelt-technology/pi-dashboard-kb` + opening `SqliteFtsStore`; confirm the native `--import` TS loader is inherited by `new Worker` in dev (`--dev`), production and the Electron-packaged runtime; else pass `execArgv: ['--import', <native-ts-register.mjs>]`. Record the outcome in `design.md`. Verify: worker indexes a 20-file fixture and the main thread reads the rows.
- [ ] 5.2 Test (fail first) `packages/kb/src/__tests__/index-abort.test.ts`: `signal` aborted mid-pass ⇒ abort error, open batch rolled back, earlier batches kept; `onProgress` fires once per committed batch with `{root,done,total}`; both omitted ⇒ rows identical. Implement `IndexOptions.signal`/`onProgress` in `indexer.ts` (check at per-file/batch boundary `indexer.ts:192-199`). Re-run 2.3 closure guard + regenerate fingerprint (indexer.ts is row-producing: one `rowsHash` bump, already covered by the migration note).
- [ ] 5.3 Test (fail first) `job-registry.test.ts`: `start(cwd, fn)` passes `{signal, progress}` to `fn`; `cancel(cwd)` aborts and settles `idle` (no `lastError`, prior `outcomes` kept); `progress` retained while running, cleared on settle; existing tests unchanged. Implement in `job-registry.ts` (backward compatible: `fn` may ignore its argument).
- [ ] 5.4 Test (fail first) `reindex-runner.test.ts` with injected `workerFactory` (precedent `credential-key.ts:260`): progress/log forwarding, result mapping, abnormal exit ⇒ rejected job, cancel ⇒ `cancel` message then `terminate()` after grace, one worker per cwd, kill-switch ⇒ in-process. Plus a real-worker integration test (small fixture): first-index cancel leaves no live DB and `sweepOrphanTemps` removes the temp; in-place cancel keeps committed batches and a re-run completes.
- [ ] 5.5 Implement: extract `indexInPlace`/`firstIndex` bodies into `reindex-core.ts` (plain-data input/output, no behaviour change; `kb-routes.test.ts`, `seed-first-index.test.ts`, `kb-routes-integrity.test.ts` stay green); add `reindex-worker.mjs` (own `loadConfig`, own store, coalesced progress ≥250 ms) and `reindex-runner.ts`; `reindexAll` keeps `resolveSpecs` + first-index wait on main, then delegates to the runner; wire `signal`/`onProgress` through `registry.start` callers (`kb-routes.ts:519,700`, `index.ts:72`).
- [ ] 5.6 Audit main-thread writers to the same `index.db` while a job runs (`stampSource`/`stampPass` moved into the core; git scope `immediate()`, trust, config). None may write; set the main read handle's `setBusyTimeout` low where a writer could exist. Verify with a test that opens a main-thread reader during a worker write (no wait > 50 ms).
- [ ] 5.7 Routes + stats (test first): `POST /api/kb/reindex/cancel?cwd=` (same `admitKbCwd` guard; `200 {cancelled}`), `progress` in `GET /api/kb/stats` (`kb-plugin-types.ts`), cancel on folder-missing and Fastify `onClose`. Update `kb-routes.test.ts`, `kb-routes-admission.test.ts`.
- [ ] 5.8 **Observability:** per-job log line (mode, files, chunks, wall ms, worker spawn→first-progress ms, main max event-loop delay via `monitorEventLoopDelay`, outcome ok|error|cancelled|crashed); worker start/exit/terminate logs; worker log forwarding with `[kb-plugin]` prefix. Test asserts the line fields for ok/error/cancelled/crashed.
- [ ] 5.9 **Performance:** re-measure with the 1.1 harness in worker mode on the ~50k-chunk corpus; record in `design.md`. Verify: main-thread max lag ≤ 200 ms (hard target), wall time ≤ 115 % of the 1.2 baseline, no `SQLITE_BUSY` for a concurrent main-thread search. If lag > 200 ms, find the residual main-thread work (likely `resolveSpecs`) before shipping.

## 6. Build, rollout, verify

- [ ] 6.1 `npm run build` in `packages/kb` (`dist` is gitignored: rebuild locally); commit the regenerated `engine-fingerprint.json`; `node scripts/check-kb-dist-fresh.mjs` exits 0.
- [ ] 6.2 Update `packages/kb/src/AGENTS.md` rows (`index-gate.ts`, `indexer.ts`), `packages/kb-plugin/src/server/AGENTS.md` rows (new `reindex-core.ts`, `reindex-worker.mjs`, `reindex-runner.ts`; `job-registry.ts`, `kb-routes.ts`), and the fingerprint/worker doc lines if present (docs under `docs/` via DocScribe).
- [ ] 6.3 `npm run reload` (kb-extension sessions) and `npx tsx .pi/skills/implement/scripts/restart-server.ts` (server loads kb + the worker). Verify: edit a comment in `packages/kb/src/render.ts`, rebuild, reindex a project ⇒ `kb_meta engine:*` unchanged, no forced pass.
- [ ] 6.4 Run `review-code` + `doubt-driven-review` on the allowlist; spawn `nodejs-expert` on the worker/runner/registry (new async + worker path, ≥3 server modules) before commit.
- [ ] 6.5 `npm test` (pipefail + log per AGENTS.md) green; `openspec validate throttle-kb-reindex --strict` passes.
- [ ] 6.6 Manual: trigger a reindex on a large KB from the dashboard; confirm `jobStatus`/`progress` in `/api/kb/stats`, cancel via `POST /api/kb/reindex/cancel`, and no `heartbeat timeout`/`watchdog FIRE` in the server log. Leave #417 open; comment on #1131 that fixes 1,2(kb-specific),4 landed and 3,5–8 remain.
