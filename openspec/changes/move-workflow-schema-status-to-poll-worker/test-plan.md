# Test Plan — move-workflow-schema-status-to-poll-worker

Stage: design   Generated: 2026-10-18   Revised: 2026-10-18 (doubt cycle 3: P4, P6, P12, P14, P15, P16 revised, P17 added; doubt cycle 4: P4, P9, P11, P12, P14, P15, P17 revised)

Hard gate passed: every Triple is filled from spec-defined values (16-read bound, exact statuses, 104-change fixture) or an existing harness value (the `directory-service-eventloop-turns` max-turn assertion, `packages/server/src/__tests__/directory-service-eventloop-turns.test.ts:195`, < 150 ms). No clarification markers. No new threshold is invented.

Code paths are in the `add-pi-spec-driven-schema` tree (on `develop` once it merges; see proposal "Sequencing"). Seams (design D2 "Test seams"): a fixture worker via the pool's existing `workerUrlOverride` (worker-side failure), `DirectoryServiceOptions.workflowSchema.computeStatus` threaded into the pool's `schemaStatusImpl` (in-process failure), `DirectoryServiceOptions.pollWorkerPoolFactory` (recording / deferring requests). P4 counts calls through the injectable fingerprint option. Ordering tests use deferred promises, not wall-clock delays.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | Workflow-schema status is computed in the poll worker on every tick (CLI upgrade) | state-transition | L1 | automated | directory last polled with CLI 1.11.0, stamp `spec-driven@1.11.0` patch 1 (`current`), gate-hit; version resolver now returns 1.12.0; no tracked path moved | tick | `generated === "outdated"`; `openspec status --all` spawn count for the tick = 0 |
| P2 | Workflow-schema status… (config.yml) | EP | L1 | automated | only `openspec/config.yml` naming `spec-driven`; gate-hit tick done; file rewritten to name `pi-spec-driven` | tick | `workflowSchema.configured === "pi-spec-driven"` |
| P3 | Workflow-schema status… (fallback list path) | EP | L1 | automated | CLI classified as not supporting `status --all`; `.openspec.yaml`-less change `a`; config names `pi-spec-driven` | tick | `workflowSchema` present with `unpinnedChanges == ["a"]`, equal to the status-all-path result for the same tree |
| P4 | Workflow-schema status… (stamp-first, lean fingerprint) + `openspec-workflow-schema` (readable stamp never `unmanaged` by fingerprint) | decision table | L1 | automated | `fingerprint: "when-needed"`, injected counting fingerprint function; rows: (1) stamp `current`; (2) stamp `outdated`; (3) no stamp in an existing dir; (4) no dir; (5) stamp `newer`; (6) stamp `conflict`; (7) stamp `current` + fingerprint function that rejects; (8) stamp `newer` + fingerprint function that rejects | worker status request | `generated`: `current` / `outdated` / `unmanaged` / `none` / `newer` / `conflict` / `current` / `unmanaged`; fingerprint calls: 0 / 0 / 0 / 0 / 1 / 1 / 0 / 1; `validateFingerprint` set only for rows 5 and 6 |
| P5 | Workflow-schema status… (bounded reads) | BVA | L1 | automated | 104 changes, 33 without `.openspec.yaml`; `readFile` spy tracking in-flight `.openspec.yaml` reads | worker status request | peak in-flight reads ≤ 16; `affectedChanges` and `unpinnedChanges` equal the unbounded result |
| P6 | Workflow-schema status… (user-schema dir on gate hit) | state-transition | L1 | automated | config names `custom`, resolvable only from the injected user schema directory; previous tick reported `missing === false`; gate-hit; `custom/` removed from the user schema directory, no tracked path moved | tick | `workflowSchema.missing === true`; `openspec status --all` spawns = 0 |
| P7 | Writing actions keep the full fingerprint | EP | L1 | automated | existing `current` schema, `previousDefault` re-stamp requested | `update` action after the poll refactor | succeeds; stamp re-written; no fingerprint-mismatch refusal |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P8 | Workflow-schema status… (worker vs in-process) | state-convergence | L1 | automated | `useWorker:false` vs `true` pool over the same fixture tree (`outdated`, 2 unpinned changes) | tick | the two `workflowSchema` objects deeply equal |
| P9 | Workflow-schema status… (shared semaphore) | state-convergence | L1 | automated | `maxConcurrentSpawns = 1`; spawn recorder capturing argv + start/end per spawn; route write guard stubbed to pass without a spawn; a poll `status --all` spawn in flight; REST `enable` needing a `newer` validate | POST enable | the spawn whose argv is `schema validate pi-spec-driven` starts only after the poll's `status --all` spawn ends (never overlapping) |
| P10 | Workflow-schema status… (resize) | state-transition | L1 | automated | route and poll built on the one semaphore; `reconfigurePolling` sets max 1 → 3 | two concurrent validates via the route | both run concurrently (peak 2) |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P11 | Workflow-schema status… (worker error) | fault-injection (abort) | L1 | automated | real pool with `workerUrlOverride` pointing at a fixture worker that rejects `schemaStatus` (answers `probe`/`build` normally) | tick | the pool's in-process fallback supplies `workflowSchema`; the tick still broadcasts |
| P12 | Workflow-schema status… (no resurrection, on-demand, log re-arm) | fault-injection (abort) | L1 | automated | previous tick broadcast `workflowSchema.generated === "current"`; fixture worker rejecting `schemaStatus` and `workflowSchema.computeStatus` throwing for gate-hit ticks 1–4, succeeding on tick 5, throwing again on tick 6 | 6 ticks, plus an on-demand read of the cached state after tick 1 | ticks 1–4 and 6: broadcast has no `workflowSchema` key, readiness unchanged; the on-demand read has no `workflowSchema`; tick 5 carries it; failure log lines for the cwd: one for ticks 1–4, one for tick 6 (2 total), each naming the fallback |
| P13 | Workflow-schema status… (newer validate) | fault-injection (abort) | L1 | automated | `newer` stamp; stub `schema validate` exits 1 | three ticks, same (cwd, fingerprint, CLI version) | `generated === "incompatible"` each tick; exactly 1 validate spawn, through the semaphore |
| P14 | Workflow-schema status… (enqueue order, once per tick, build not gated) | fault-injection (delay) | L1 | automated | `maxConcurrentSpawns = 1`; pool from `pollWorkerPoolFactory` recording enqueue order with `schemaStatus` held on a deferred promise; CLI stubs resolved manually | (a) gate-hit tick; (b) miss tick, CLI resolved while `schemaStatus` is still held; (c) tick that detects `--all` unsupported; (d) tick with `--all` already known unsupported | (a)(b) `probe` enqueued before `schemaStatus`; (b) `build` enqueued while `schemaStatus` is still pending, finalize completes after it is released; (c) exactly one `schemaStatus` request for the tick; (d) `schemaStatus` enqueued before the `list` spawn starts |
| P15 | Worker-safe status module | EP | L1 | automated | the transitive static import closure of `packages/server/src/openspec/workflow-schema-status.ts`; the direct imports of `openspec-poll-worker.ts` | static import-graph assertion | closure contains no `platform/openspec.js`, `platform/runner.js`, `semaphore.js`, `openspec-poller.js` or `workflow-schema.ts`; the worker's direct imports contain no `platform/openspec.js`, `platform/runner.js` or `semaphore.js` (the `openspec-poller.js` edge is grandfathered) |
| P17 | Exhaustive request dispatch | EP | L1 | automated | a `schemaStatus` request and a request with an unknown kind, sent to the worker handler, to `runAsyncInProcess`, and to a disposed pool | dispatch | `schemaStatus` returns `{ status, validateFingerprint? }` at all three sites (not a derive/build payload); the unknown kind rejects at all three |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P16 | Per-turn main-thread work does not block the event loop | threshold | L1 | automated | two 104-change cwds, schema `current`, worker pool of 1, 20 gate-hit ticks | tick loop (existing `directory-service-eventloop-turns` harness) | max instrumented main-thread turn < 150 ms (the harness's existing assertion, `directory-service-eventloop-turns.test.ts:195`); every tick broadcasts a `workflowSchema` for both cwds |

---

## Coverage summary

- Requirements covered: the ADDED "Workflow-schema status is computed in the poll worker on every poll tick" (all bullets and 9 scenarios), the MODIFIED gate requirement (cache not reused for `workflowSchema`), and the MODIFIED `openspec-workflow-schema` "Workflow schema status is reported separately from readiness" (per-tick recompute: P1, P2, P6; failure omission, on-demand state and recovery: P12; stamp-first `generated`: P4 rows 7–8; `newer`/`conflict` validate: P4, P13).
- Scenarios by class: edge 7 · perf 1 · frontend 3 · error 6
- Scenarios by level: L1 17
- Scenarios by disposition: automated 17 · manual-only 0

## New infra needed

- Test seams `pollWorkerPoolFactory`, `workflowSchema.computeStatus` → pool `schemaStatusImpl` (task 2.1), and a fixture worker for `workerUrlOverride` that rejects `schemaStatus` (task 2.1). P15 is a small static import-graph test.
