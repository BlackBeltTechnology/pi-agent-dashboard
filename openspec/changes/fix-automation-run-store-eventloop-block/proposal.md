## Why

The automation plugin's run store blocks the dashboard server's event loop for minutes. Every 60 s (`REAP_INTERVAL_MS`, `packages/automation-plugin/src/server/engine.ts:741`) `reapStaleRuns` → `listStaleRunningRuns` → `listRuns` → `readRecord` walks every `runs/<id>/run.json` (and each parent's children) with **synchronous** `fs.readdirSync` / `fs.readFileSync` (`packages/automation-plugin/src/server/run-store.ts`). When a scope lives on a cloud-backed file system — on this macOS host `~/Documents` is iCloud Drive (FileProvider domain), and `~/Documents/.pi/automation/runs/` holds 184 run dirs / 366 `run.json` — a sync read of an evicted or in-sync file waits for FileProvider to materialise it. The whole single-threaded server waits with it.

Field evidence (2026-11-26, live CDP CPU profile of pid 16511 via SIGUSR1, 360 s window, gap analysis on `timeDeltas`): **one 184,660 ms gap** whose prior-sample stack is `readFileSync ← readRecord (run-store.ts:58) ← listRuns (:366) ← listStaleRunningRuns (:390) ← reapStaleRuns (engine.ts:485) ← setInterval`. The same boot window earlier showed a 208,843 ms `eventLoopSpikes` entry. Effects observed: `/api/health` and the web UI hang, bridges force-closed after 74 s of silence (`watchdog_force_close`), 7 sessions dropped on 180 s heartbeat timeout. A warm re-read of the same 366 files takes 0.03 s, so the stall leaves no trace once it ends — it recurs whenever macOS evicts the files again ("Optimize Mac Storage").

The listing is not the only whole-scope sync walk. Every finalize write (`finishRun*`, `finishParentRun*`) calls `pruneRuns`, which does a sync `listRuns` over the whole scope. Child-id lookups go through `resolveRunDir`, a sync `readdirSync` of the scope root. These run from the reaper, from Stop (`stop-run.ts`), from session-end finalization and from the run routes (`routes.ts`). Making only the listing async would leave the same stall on every reap, Stop and run completion.

## What Changes

- **The run store goes asynchronous (plugin-internal API).** Every file-system operation in `run-store.ts` moves to `node:fs/promises`, and no synchronous fs call remains. Mutations persist write-behind: `start*` still return the in-memory `RunRecord` synchronously (run ids are minted without I/O), so the fire path, `runner.ts`, `scheduler.ts` and `index.ts` keep their synchronous signatures. `finish*`/`setSessionId` return a Promise, the CAS `…IfRunning` return `Promise<boolean>`, and the reads (`readRun`, `readChildRuns`, `listRuns`, `listStaleRunningRuns`, `findRunBySessionId`, `resolveRunDir`) return Promises.
- **Per-run ordered writes.** Each run has an in-process async lock keyed by its runId and acquired synchronously when the store is called, so writes apply in issue order and a compare-and-set can't be won twice. Operations that touch two records (a child start appends to its parent) take both locks, parent first, so sibling starts can't lose parent-link updates. Temp files are unique per write.
- **Decide synchronously, persist asynchronously.** The engine keeps every exactly-once decision on in-memory state before any await. `findings` comes from a shared helper instead of the write's return value.
- **Pruning off the finalize path.** Retention pruning runs after the terminal write settles, coalesced per (scope, automation), holding the locks of the records it removes.
- **The reaper splits by data source.** An **in-memory pass** (no I/O, every tick) reaps live runs past max age and frees their slot, so a hung file system can never wedge a live automation. A **disk pass** for orphans from a previous process is single-flight per scope. While a scope's pass is pending, a scheduled tick skips it and logs a still-pending warning. The disk pass keeps "orphan parent finalizes in the same sweep that reaps its stale child". Ages use the tick-start clock. A disposed engine writes nothing. `reapStaleRuns(): Promise<void>` joins pending passes. The reaper's abort fires only when its own call finalized the run. A run being stopped is left to the Stop for a 60 s grace, so a hung Stop can't hold the slot forever.
- **Bounded threadpool use.** Run-store fs ops pass a per-scope semaphore (1) and a global one (3). One hung scope pins one threadpool thread, and at least one of libuv's 4 threads always stays free for the rest of the server.
- **Async Stop and run routes.** `stop-run.ts` waits for a run's pending writes before reading it (so a just-finished run reads as finished), keeps its dedupe insert synchronous, and uses async `realpath`. `routes.ts` awaits the store and coalesces identical concurrent listings per (scope, name).
- **Observability.** Any run-store fs operation still pending at `SLOW_RUN_STORE_OP_MS` (1000 ms) after it gets its turn logs one `run-store op slow` warning while it is pending, naming the scope base path and the operation. Queue wait over the threshold is logged separately. The route hooks gain a logger.
- **Test seam.** `engine.flushPersistence()` (store `drainRunStore()`) lets tests await write-behind persistence before asserting disk state.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-run-lifecycle`: adds requirements that run-store reads and writes SHALL NOT block the server, that reaper sweeps are single-flight per scope and observable while pending, that exactly-once finalization holds under asynchronous persistence, and that slow reads are logged. Existing reaper, stop and listing requirements are unchanged.

## Discipline Skills

- `performance-optimization`: a latency budget is at stake (a multi-minute event-loop stall on `/api/health` and every WS/HTTP path). Measure-first evidence is the CDP profile above; verification re-measures `eventLoopSpikes`.
- `observability-instrumentation`: adds the slow-op, queue-wait and still-pending warnings so the stall is attributable from `server.log`.
- `doubt-driven-review`: the sync→async change of a persistence layer that carries exactly-once guarantees is irreversible-in-spirit for its callers. Reviewed in planning (2 cycles × 2 reviewers).
- `systematic-debugging`: the root cause was established phase-by-phase (health probe → spike ring → CPU profile → gap attribution → iCloud FileProvider check). The tasks keep a reproduction test that simulates a slow file system.

## Impact

- `packages/automation-plugin/src/server/run-store.ts`: all fs on `fs/promises`; write-behind with a per-record lock; unique temp files; per-scope semaphore; decoupled prune; `resolveRunDir(…, parentRunId?)`; `findingsFor`; `drainRunStore`.
- `packages/automation-plugin/src/server/engine.ts`: `store*` call sites; `RunContext.startedAt`; reaper split into the in-memory and disk passes; `reapStaleRuns(): Promise<void>` (`engine.ts:394`); `flushPersistence()`; disposed guard; `finalizeChild` returns `boolean`.
- `packages/automation-plugin/src/server/stop-run.ts`: awaits the async store.
- `packages/automation-plugin/src/server/routes.ts`: awaits the async store; per-scope listing coalescing; `AutomationRouteHooks` gains a `warn` logger.
- `packages/automation-plugin/src/server/AGENTS.md` (+ per-file sidecars where present): row updates.
- Tests: every suite that asserts run-store disk state (`engine`, `run-store`, `stop-pipeline`, `routes-stop`, `run-work-item`, `work-source-fanout`, `flows-run-finalizes-on-forwarded-completion`, `runner`, `result-capture`, `routes-credential-seam`, `routes-cwd-admission`, `AutomationBoard.test.tsx`) gets `await`/`flushPersistence()`.
- **Compatibility:** no REST shape, on-disk format or config change. The run-store API change is internal to the plugin (no imports outside `packages/automation-plugin/`). `packages/electron/resources/server/**` is gitignored build output and is regenerated.
- **Migration:** none.
- **Rollback:** plain revert of this change's commit. It contains only this change: the session's earlier `/api/health` fixes are committed separately. On-disk records are format-identical, so a reverted server reads them unchanged.

## Context

This session also fixed two other `/api/health` hot-path stalls, outside this change and uncommitted in the working tree: `readLivePpid` no longer forks a synchronous `ps` on macOS (1–4 s stalls), and keeper-log stats now refresh asynchronously, with zero-byte `keeper-launch-*.log` tombstones pruned. With those fixes live, the profile above isolates the run store as the remaining multi-minute stall.
