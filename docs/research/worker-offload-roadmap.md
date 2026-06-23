# Worker Offload Roadmap

## Purpose

Tracks main-loop offload changes. CPU-bound + sync-fs work moves to worker_threads. Main thread keeps cache, dedup, broadcast, semaphore ownership. Reuses proven pattern. Avoids divergent pools.

## Proven pattern (shipped)

- Change `offload-openspec-poll-to-worker`. Archived 2026-06-15.
- Files: `packages/server/src/openspec-poll-worker.ts`, `packages/server/src/openspec-poll-worker-pool.ts`.
- Pool: fixed size `min(maxConcurrentSpawns, os.cpus().length)`. Clamps >=1. FIFO queue. Per-request timeout. In-process fallback on spawn/crash/timeout. Lifecycle tied to DirectoryService start/stop.
- Dispatch model = Pattern B (fan-out). Tick fans all cwds via `Promise.all` in `scheduleOpenSpecTick` (directory-service.ts). Pool `pickFreeSlot` spreads jobs across slots = multi-core. Per-cwd `try/catch` isolates failure. `openspecTickInFlight` guard = skip-when-busy backpressure.
- Worker imports pure helpers: `deriveArtifactStatus`, `createFsProbeFactory`, `createFsSpecsProbeFactory`, `effectiveMtimeOr`. No logic duplicated. Serializes once in-worker.
- Flag: `DashboardConfig.openspec.useWorker` defaults true. false = permanent in-process.

## Candidate work set (main-loop blockers)

### Tier 1

- `scanAllSessions()` in `session-scanner.ts`. Boot blocker. Called server.ts:208 before HTTP listen. Sync `readdirSync` + per-file `extractSessionStats` (`readFileSync` + `JSON.parse` per line over full JSONL). Largest session JSONL 52 MB on affected machine. Caches via `.meta.json` sidecars. Stalls on cold start or mtime-dirty large sessions. Side effect: writes `.meta.json` per session.
- `loadSessionEvents` in `directory-service.ts` (~line 289). Hydration path. `subscription-handler.ts:239` awaits inside ws handler. `loadSessionEntries` (`readFileSync` + `JSON.parse` per line + tree-walk) + `replayEntriesAsEvents`. Blocks other sessions' token streaming. Output multi-MB events array. Needs cancellation.

### Tier 2

- `pi-resource-scanner.ts` `scanPiResources` (line 340). Periodic 5x `pollIntervalSeconds` per cwd. Already async but sync fs internals. Low urgency. Offload only if metrics correlate.

## Change sequence

1. `instrument-session-hydration-timing` (measurement-only). Adds `perf_hooks` `monitorEventLoopDelay` + hydration ring buffer to `/api/health`. Prerequisite for #2. Status: proposed.
2. `offload-session-events-load-to-worker`. Copies poll-pool scaffold. Adds `cancel(jobId)`. Flag `sessions.useLoadWorker`. Depends on #1. Status: proposed.
3. `offload-session-scan-to-worker` (future). Partitions by `cwdDir`. Worker writes own `.meta.json`. Runs before HTTP listen = extra timeout care. Status: not proposed.
4. Generic pool extraction at 3rd consumer. Rule of three. Extracts `worker-pool.ts <Request,Response>`. Migrates openspec-poll + session-events + session-scan. Cancellation requirement from #2 + side-effecting-write requirement from #3 shape generic. Status: not proposed.

## Rule of three

Do not extract generic pool before 3rd consumer. One consumer (openspec-poll) under-constrains abstraction. Session-events needs cancel. Scan-sessions needs side-effecting writes. Two more consumers fix correct generic shape.

## Pattern B notes

- Fan-out per tick/burst = multi-core. Serial await per job defeats purpose.
- `Promise.allSettled` for partial-failure isolation when one dispatch site batches many jobs.
- Broadcast order across jobs non-deterministic under fan-out. Payloads keyed by `cwd`/`sessionId`. Clients order-independent.
- Each worker has own libuv threadpool (4 threads). N workers = 4N concurrent fs slots.
- Consider `os.availableParallelism()` (Node 19+) over `os.cpus().length` for cgroup-quota deploys (Electron sandbox, Docker).
- Pre-spawn pool at start. Never spawn-per-tick (V8 isolate init ~30-80ms).
- Structured-clone copies payload in+out. Accept cost first. `transferList`/SharedArrayBuffer only if measured.
