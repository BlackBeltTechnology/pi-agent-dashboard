## Why

Even after scoping the poll work set (`scope-openspec-poll-to-active-cwds`) and serializing broadcasts once, the OpenSpec poll tick still performs **CPU-bound and synchronous-fs work on the main event loop**: synchronous `statSync` / `existsSync` / `readdirSync` / `readFileSync` in the mtime gate and the local evidence probes (`openspec-design-evidence.ts`, `openspec-specs-evidence.ts`), plus `JSON.stringify` of per-cwd poll payloads. On a repository with many active changes (62 measured on the affected machine) a single gate-opening tick can hold the loop long enough to delay HTTP responses and the WebSocket frames that carry streamed LLM tokens — the user-visible "streaming hangs, reload fixes it" symptom.

`async/await` does **not** solve this: the CLI spawns are already async (`runAsync` / `child_process`), but `JSON.stringify` is pure main-thread CPU, and converting sync fs to `fs.promises` only relocates the work to the **libuv threadpool (default 4 threads)**, which is shared with DNS/crypto/zlib and saturates under the per-tick stat fan-out. The architecturally correct fix for CPU-bound periodic work is to run it off the main loop in a dedicated worker.

This change moves the derive-and-diff portion of the poll tick into a `worker_threads` worker. The main loop keeps ownership of the cache, the broadcast, and the CLI-spawn semaphore; the worker performs the fs evidence probes, artifact derivation, and payload serialization, returning a ready-to-broadcast result.

## What Changes

- **NEW** `packages/server/src/openspec-poll-worker.ts` — a `worker_threads` worker. Input message: `{ cwd, changesRoot, listResult, gateEnabled, perChangePreMtimes }`. Output message: `{ cwd, data, serialized, changeMtimes }` where `data` is the `OpenSpecData`, `serialized` is its `JSON.stringify` result (done in-worker so the main loop never stringifies the large payload), and `changeMtimes` carries the post-derive mtimes for the TOCTOU gate. The worker imports the existing pure functions (`deriveArtifactStatus`, `createFsProbeFactory`, `createFsSpecsProbeFactory`, `effectiveMtimeOr`) — no logic is duplicated, only relocated.
- **NEW** `packages/server/src/openspec-poll-worker-pool.ts` — a small fixed-size worker pool (size = `min(maxConcurrentSpawns, os.cpus().length)`, clamped ≥1) with a request queue and per-request timeout. Lifecycle tied to `DirectoryService` start/stop. Falls back to in-process derivation when worker spawn fails (resilience; never hard-depends on the worker).
- **MODIFY** `packages/server/src/directory-service.ts::pollOne()` — on the periodic/gated path (`force === false`), dispatch the per-change derivation + serialization to the worker pool instead of running it inline. The `openspec list` CLI spawn, the semaphore, the cache write, and the broadcast stay on the main thread. The force path (authoritative `openspec status` per change) is unchanged — it is rare and already async.
- **MODIFY** the tick's diff/broadcast (`directory-service.ts:551-556`) — consume the worker's `serialized` string for the `nextJson !== prevJson` comparison and pass it through to `broadcast()` so the payload is serialized exactly once, in the worker.
- **NEW** `packages/server/src/__tests__/openspec-poll-worker.test.ts` — parity test: worker output `data` equals the in-process derivation for a fixture change set, and `serialized === JSON.stringify(data)`. Plus a fallback test: when the worker is unavailable the poll still produces correct data in-process.
- **DOCUMENTATION** — `docs/architecture.md`: new "OpenSpec poll worker" subsection (main-thread vs worker responsibility split, fallback behavior, pool sizing). File-index rows for the two new files.

## Non-Goals

- Not moving the CLI spawns into the worker — they are already async and off-loop.
- Not moving any other subsystem (event pipeline, git, terminals) to workers. This change is scoped to the OpenSpec poll path only.
- Not changing the mtime-gate semantics or TOCTOU guard — only *where* the derivation runs.

## Dependencies / Sequencing

- **Should land after** `scope-openspec-poll-to-active-cwds`. That change cuts the work set ~6× and adds serialize-once at the broadcast layer; profiling after it may show worker offload is unnecessary. Treat this proposal as the escalation path **if** main-thread stalls persist under realistic load after scoping + serialize-once.

## Migration / Compatibility / Rollback

- **Migration**: none. No persisted state, schema, or protocol change. The worker is an internal implementation detail of `DirectoryService`.
- **Compatibility**: `openspec_update` payload shape is byte-identical (parity test enforces `serialized === JSON.stringify(data)`). Clients see no difference.
- **Rollback**: feature-flag the dispatch (`DashboardConfig.openspec.useWorker`, default true after bake-in; false reverts to in-process derivation). The in-process fallback path is retained permanently for environments where `worker_threads` is unavailable (e.g. constrained bundles), so rollback is a config flip, not a redeploy.
- **Risk**: worker serialization boundary copies `listResult` + result payloads (structured clone). For the measured payload sizes (tens of KB) this is cheaper than the main-loop stall it removes; the parity + timeout + fallback tests bound the risk. Worker crash → pool respawns and the tick falls back in-process for that cycle.
