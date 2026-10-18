# Test Plan — move-workflow-schema-status-to-poll-worker

Stage: design   Generated: 2026-10-18

Hard gate passed: every Triple is filled from spec-defined values (16-read bound, 150 ms turn budget from the existing "Per-turn main-thread work" requirement, 104-change fixture, exact statuses). No clarification markers. The performance row reuses the existing per-turn threshold; no new threshold is invented.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | Workflow-schema status is computed in the poll worker on every tick (CLI upgrade) | state-transition | L1 | automated | directory last polled with CLI 1.11.0, stamp `spec-driven@1.11.0` patch 1 (`current`), gate-hit; version resolver now returns 1.12.0; no tracked path moved | tick | `generated === "outdated"`; `openspec status --all` spawn count for the tick = 0 |
| P2 | Workflow-schema status… (config.yml) | EP | L1 | automated | only `openspec/config.yml` naming `spec-driven`; gate-hit tick done; file rewritten to name `pi-spec-driven` | tick | `workflowSchema.configured === "pi-spec-driven"` |
| P3 | Workflow-schema status… (fallback list path) | EP | L1 | automated | CLI classified as not supporting `status --all`; `.openspec.yaml`-less change `a`; config names `pi-spec-driven` | tick | `workflowSchema` present with `unpinnedChanges == ["a"]`, equal to the status-all-path result for the same tree |
| P4 | Workflow-schema status… (lean fingerprint) | decision table | L1 | automated | rows: stamp `current`, `outdated`, `unmanaged`, no dir, `newer`, `conflict` | worker status request | `fingerprintDir` calls: 0 / 0 / 0 / 0 / 1 / 1; the returned `validateFingerprint` is set only for the last two |
| P5 | Workflow-schema status… (bounded reads) | BVA | L1 | automated | 104 changes, 33 without `.openspec.yaml`; `readFile` spy tracking in-flight `.openspec.yaml` reads | worker status request | peak in-flight reads ≤ 16; `affectedChanges` and `unpinnedChanges` equal the unbounded result |
| P6 | Gate requirement (MODIFIED) | decision table | L1 | automated | gate-hit tick; cached payload carries `workflowSchema.generated === "current"` while the directory's stamp is now `outdated` | tick | broadcast has `generated === "outdated"`; `openspec status --all` spawns = 0 |
| P7 | Writing actions keep the full fingerprint | EP | L1 | automated | existing `current` schema, `previousDefault` re-stamp requested | `update` action after the poll refactor | succeeds; stamp re-written; no fingerprint-mismatch refusal |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P8 | Workflow-schema status… (worker vs in-process) | state-convergence | L1 | automated | `useWorker:false` vs `true` pool over the same fixture tree (`outdated`, 2 unpinned changes) | tick | the two `workflowSchema` objects deeply equal |
| P9 | Workflow-schema status… (shared semaphore) | state-convergence | L1 | automated | `maxConcurrentSpawns = 1`, poll `status --all` spawn in flight, REST `enable` needing a `newer` validate | POST enable | the validate spawn starts only after the poll spawn ends (spawn timestamps ordered, never overlapping) |
| P10 | Workflow-schema status… (resize) | state-transition | L1 | automated | route and poll built on the one semaphore; `reconfigurePolling` sets max 1 → 3 | two concurrent validates via the route | both run concurrently (peak 2) |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P11 | Workflow-schema status… (worker error) | fault-injection (abort) | L1 | automated | worker errors on the status request | tick | in-process fallback supplies `workflowSchema`; tick still broadcasts |
| P12 | Workflow-schema status… (cache not resurrected) | fault-injection (abort) | L1 | automated | gate-hit tick; cached payload has `workflowSchema` `current`; status computation throws in worker and in-process | tick | broadcast payload has no `workflowSchema` key; one log line for the cwd with the fallback taken; three further failing ticks still log once for that cwd |
| P13 | Workflow-schema status… (newer validate) | fault-injection (abort) | L1 | automated | `newer` stamp; stub `schema validate` exits 1 | three ticks, same (cwd, fingerprint, CLI version) | `generated === "incompatible"` each tick; exactly 1 validate spawn, through the semaphore |
| P14 | Workflow-schema status… (scheduling) | fault-injection (delay) | L1 | automated | `maxConcurrentSpawns = 1`; pool spy recording enqueue order and a 300 ms-slow status request | gate-hit tick, then a miss tick | `probe` is enqueued before `schemaStatus` in both; on the miss tick `build` is not delayed beyond the status completion (build starts after the CLI returns, status already resolved) |
| P15 | Worker body is worker-safe | EP | L1 | automated | the module graph reachable from the `schemaStatus` request body | static import-graph assertion | contains no import of `platform/openspec.js` recipes, `semaphore.js`, or `resolveExecutorArgv` |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P16 | Per-turn main-thread work does not block the event loop | threshold | L1 | automated | 104-change fixture, schema `current`, worker pool of 1, gate-hit ticks ×20 | tick loop (existing `directory-service-eventloop-turns` harness) | no instrumented main-thread turn exceeds the per-turn alarm threshold of the existing requirement; every tick broadcasts a `workflowSchema` |

---

## Coverage summary

- Requirements covered: the ADDED "Workflow-schema status is computed in the poll worker on every poll tick" (all bullets and 8 scenarios) and the MODIFIED gate requirement (cache not reused for `workflowSchema`).
- Scenarios by class: edge 7 · perf 1 · frontend 3 · error 5
- Scenarios by level: L1 16
- Scenarios by disposition: automated 16 · manual-only 0

## New infra needed

- none. P14 uses a thin spy around the existing pool factory; P15 is a small static import-graph test.
