## Context

See proposal.md (Why) for the field evidence. Current shape:

- `run-store.ts` is a module of sync free functions over `runsRootFor(scopeBase)` = `<scopeBase>/runs/` (`run-store.ts:31`). Layout is exactly two levels: top-level `runs/<runId>/run.json` (parent or legacy flat) and nested `runs/<parentRunId>/<childRunId>/run.json`. `writeRecordAt` (`:108`) writes through a fixed `run.json.tmp` and then renames.
- `start*` (`:122,146,170`) build the `RunRecord` in memory, write it and return it. `startChildRun` also read-modify-writes the **parent's** record to append to `children`. `setSessionId` (`:201`) and `finish*` (`:213-303`) RMW one record. `finish*` call `pruneRuns` (`:415`) unless `{ prune: false }`, and `pruneRuns` → `listRuns` (`:366`) reads every record in the scope. `resolveRunDir` (`:89`) scans the root to find a child under its parent. `readRecord` (`:58`) maps any read/parse error to `null`, which listings skip.
- `engine.ts` (`createEngine` factory, `:424`) keeps live state in closures: `pending`/`parents` maps, `RunContext` (`:255-300`: runId, parentRunId, scopeBase, sessionId, `stopInFlight`, `finalized`; no `startedAt`), parent `remaining` counters, `runner.completeRun`. The fire path (`startRunFor` → `storeStartParentRun`/`spawnChild` → `storeStartChildRun`, `:723-1172`) is synchronous and feeds `RunnerDeps.startRun` (`runner.ts:34,70`) and `Scheduler.onFire` (`scheduler.ts:138`). `finalizeChild` (`:605`) uses the store's return only for `findings` (`:631`).
- `reapStaleRuns` (`engine.ts:485-571`, `setInterval(60_000)` at `:1213`) runs two passes per scope. The stale pass is `listStaleRunningRuns` → `finalizeChild` + `abortSpawnedRun` (live) or `storeFinishRunIfRunning` (on-disk orphan). The orphan-parent pass re-lists **after** the stale pass "so a just-reaped child counts" (`:548`; pinned by `engine.test.ts:847`).
- `stopChild` (`engine.ts:657-676`) sets `ctx.stopInFlight` and finalizes after `abortWithOutcome` resolves. `stop-run.ts:136-204` reads records and uses `fs.realpathSync` (`:71,108`). `routes.ts:311-380` calls the sync primitives.
- libuv's threadpool (default 4 threads) is shared by every `fs.promises` call, `dns.lookup`, zlib and crypto in the server.

## Goals / Non-Goals

**Goals:**
- No `fs.*Sync` call in `run-store.ts` or `stop-run.ts`. No run-store I/O on the event loop from the reaper, Stop, finalization or the routes.
- Exactly-once finalization, CAS semantics, parent-link integrity and existing reaper timing (including "orphan parent finalizes in the same sweep") preserved.
- Live wedged runs are reaped and their slot freed even when the file system never answers. A hung scope pins a bounded number of threadpool threads and is visible in `server.log` while pending.
- The fire path stays synchronous for its callers (`runner.ts`, `scheduler.ts`, `index.ts` unchanged).

**Non-Goals:**
- Scanner / `folder-work-source`, the action prompt-file read on the fire path (`engine.ts:98`) and the routes' git probe (`routes.ts:280`). These are other sync I/O on the same class of path, recorded as follow-ups and not claimed by this change's invariant.
- Cancelling an in-flight fs read. Cross-process locking.

## Decisions

### D1 — `fs/promises`, not `worker_threads`

The cost is I/O wait, not CPU. *Rejected:* a worker pool. It's heavier, with no extra benefit for pure I/O wait.

### D2 — Decide synchronously, persist write-behind

The engine takes every exactly-once decision on in-memory state before any await: `ctx.finalized`, `parent.finalized`, `remaining`, `completeRun`, lease ack/nack, `removePending`. The store's mutating API **returns synchronously what callers used to read back** and persists write-behind:
- `start*` return the in-memory `RunRecord` synchronously (run ids minted by `makeRunId`, pure) and enqueue the write. `startRunFor`, `RunnerDeps.startRun` and `Scheduler.onFire` keep their sync signatures.
- `finish*` / `setSessionId` enqueue the RMW and return `Promise<RunRecord | null>`. The engine never needs the value, because `findings` comes from an exported `findingsFor(result, status)` helper that the store also uses (same trim and archived→0 rule as `finishRecordAt`).
- `…IfRunning` (CAS, on-disk orphans only: reaper and Stop, both already async) return `Promise<boolean>`.
Every write-behind promise is `.catch`-logged with its runId. *Rejected:* awaiting before deciding, which adds interleaving windows and pushes async up through runner and scheduler.

### D3 — Per-run lock keyed by runId, acquired synchronously at call time

`withRunLock(runId, fn)` chains on a module-level `Map<runId, Promise>`. The key is the **runId** (globally unique: `makeRunId` = date-time-name-seq), so every caller can acquire it synchronously, including runId-only callers (reaper CAS, Stop leaf, `/result`), with no path resolution and no scope-spelling normalization. The chain link is appended **synchronously when the store function is called**, before any await, so issue order = apply order. A CAS (`…IfRunning`) reads, checks and writes inside one lock hold, so two racing CAS calls on one run can't both win. Entries are deleted when their chain settles. Multi-record operations take locks in a fixed order (parent runId, then child runId):
- `startChildRun` holds the parent lock for the `children` append and the child lock for the child write. Sibling starts serialize on the parent lock, so there are no lost link updates.
- Fire-path ordering: the parent's `start` write is enqueued on the parent lock before any child start, so the link append always sees the parent record.
- Temp files are unique per write (`run.json.<pid>.<seq>.tmp`).
Module scope is deliberate: the store owns the files, and two engines in one process must not race on a run.

### D4 — Child lookup without a scope scan

`resolveRunDir(scopeBase, runId, parentRunId?)`: when the parent is known (engine `ctx.parentRunId`, Stop's parent record), the path is computed directly. The async `readdir` scan remains only for runId-only callers (`/result`).

### D5 — Pruning decoupled, chained, coalesced with a rerun bit

`finish*` with pruning enabled schedule `pruneRuns(scope, name, retention)` **after their own write settles**. Requests coalesce per `(scope, name)` (largest retention wins). A request that arrives while a prune is in flight sets a **rerun** bit, and the prune runs once more after it settles, so a terminal record written after the in-flight listing is still trimmed. Entries are deleted on settle, including on failure (logged). `{ prune: false }` callers (orphan Stop, reaper orphan) schedule nothing, as today. Prune removes a terminal top-level occurrence only while holding its parent lock and each child's lock.

### D6 — Reaper: in-memory pass always; disk pass per-scope single-flight

The sweep splits by data source:
1. **In-memory pass, no I/O, every tick.** For each live `RunContext` in `pending` with `now − ctx.startedAt > maxRunAgeMs`, skipping `ctx.finalized` and skipping `ctx.stopInFlight` only while the Stop is younger than `STOP_GRACE_MS` (60 s; a hung host abort can't wedge the slot): `finalizeChild` then `abortSpawnedRun` (only if `finalizeChild` returned `true`). `ctx.startedAt` is set by one `makeRunContext` helper (the only `RunContext` constructor) from the same clock the record uses (`deps.now?.() ?? Date.now()`, which is also passed as `at` to `start*`), so in-memory and on-disk ages agree. This frees the concurrency slot, the point of the existing "never wedge permanently" guarantee, without touching the disk, so a hung file system can't block it.
2. **Disk pass, per-scope single-flight, for on-disk orphans** (records with no live context, from a previous process). Per-scope state `Map<scopeBase, {promise, startedAt}>` lives in the engine closure. A scheduled tick skips a pending scope and logs `[engine] reaper disk sweep still pending: <ms>ms scope=<base>` (at most once per tick per scope). The pass lists the scope, CAS-finalizes stale orphan children/flat records with `finishRunIfRunning`, **awaits those writes**, then re-reads the children of each running orphan parent (not the whole scope) and CAS-finalizes parents whose children are all terminal. That keeps "orphan parent finalizes in the same sweep that reaps its stale child". The `[finalize] path=reaper` log is emitted only when the CAS returns `true`.
- **Clock:** `now` is sampled once at tick start, a conservative choice: a run younger than max age at tick time is never reaped.
- **Disposed guard:** `dispose()` sets `disposed` first, and every await in the disk pass is followed by `if (disposed) return`.
- **Entry points:** an internal `sweep({ scheduled })`. The timer calls `void sweep({ scheduled: true }).catch(warn)`, and pending scopes are skipped. `reapStaleRuns()` (interface `engine.ts:394`, now `Promise<void>`) calls `sweep({ scheduled: false })`, which **joins** pending disk passes and resolves when all have settled. It never resolves early.

### D7 — Bounded threadpool use: per-scope 1, global 3

Every fs op in `run-store.ts` passes two FIFO semaphores: **per scope 1** (key `path.resolve(scopeBase)`, sync, no I/O) and **global 3**. One hung scope pins 1 threadpool thread. Up to three hung scopes pin 3, and **at least one of libuv's 4 threads always stays free** for the rest of the server (`/api/health`, static files, dns). A healthy scope still proceeds while one scope hangs (global capacity 3 > 1). With 3+ hung scopes, run-store work on other scopes queues, but live reaping (in-memory) and the server are unaffected. Listings read sequentially and per record; a rejected `readFile`/`JSON.parse` maps to `null` and is skipped (existing fault isolation, kept).

### D8 — Routes: coalesced per (scope, name), drained on settle

`routes.ts` coalesces concurrent identical listings per `(scopeBase, name)` and deletes the entry on settle (fulfilled or rejected), so a failure never poisons later requests. Only requests that arrive while the read is in flight share it, the same race fast storage has. `annotate`/`runFacts` run when the listing resolves. `AutomationRouteHooks` gains `warn?`, wired to the plugin logger in `index.ts`.

### D9 — Slow-op warning at the store, while pending

`SLOW_RUN_STORE_OP_MS = 1000`, with a `>=` rule. Instrumentation lives in the store's semaphore wrapper, so **every** fs-backed store op is covered: listings, RMW reads/writes, CAS, Stop reads and prune. The timer starts when the op **acquires its permits**, so queue wait is not blamed on storage. If the op is still pending at the threshold, it logs exactly one `run-store op slow: >=1000ms scope=<base> op=<op>` line, once per op invocation. A coalesced listing is one invocation and logs once. Queue wait beyond the threshold logs one separate `run-store queue wait: >=1000ms scope=<base>` line, so contention is distinguishable from slow storage.

### D10 — Stop sees persisted state; dedupe stays synchronous

Before reading a record, `stop-run.ts` awaits that run's lock chain tail (`whenSettled(runId)`). A run finalized in memory but still persisting is then read as terminal, so it gets "already finished" instead of a `REAPER_REJECT`. The Stop **dedupe key is computed synchronously** from the runId (globally unique) before any await, so a direct child Stop and a parent cascade still dedupe on the same entry (`stop-run.ts:166-184` relies on the synchronous insert). `fs.realpathSync` → `fs.promises.realpath`, used only for the scope-admission comparison after the dedupe insert.

### D11 — Test drain hook

The store exports `drainRunStore(): Promise<void>` (awaits every lock chain and scheduled prune). The engine exposes `flushPersistence()` delegating to it. Tests that assert disk state after a sync engine call `await engine.flushPersistence()` first. This is the only test-facing addition.

## Risks / Trade-offs

- [Crash between an in-memory decision and its write-behind] → After a restart the record is an on-disk orphan, which the reaper's disk pass / orphan Stop already handle. The same crash under the sync design lost in-memory state too. Write failures are logged per runId.
- [A hung scope never finishes its disk pass] → Orphans in that scope wait until storage answers. Live runs are still reaped by the in-memory pass. The still-pending line repeats each tick, and the scope pins 1 threadpool thread; ≥ 1 of 4 always stays free (D7).
- [The promise queue behind a hung scope grows (ticks skip, but writes and listings queue)] → Bounded in practice by run rate (one write chain per run, coalesced listings and prunes). The slow-op and queue-wait lines make it visible.
- [`finalizeParent` releases the slot (`completeRun`) before the parent write settles] → Intentional (D2). A crash in that window leaves an orphan parent, which the disk pass finalizes.
- [Parent-link loss if a parent `start` write fails] → Logged. The child record exists but is unlinked, and the live child is still tracked and reaped in memory. After a restart an unlinked child is invisible to the disk pass, which is the same failure class as a failed sync write today.
- [The run-store API becomes partly async] → Plugin-internal only (verified: no imports outside `packages/automation-plugin/`). `start*` stay sync-returning, so runner, scheduler and index are unchanged.
- [Test churn] → Many suites assert disk state right after sync calls (`engine`, `run-store`, `stop-pipeline`, `routes-stop`, `run-work-item`, `work-source-fanout`, `flows-run-finalizes-on-forwarded-completion`, `runner`, `result-capture`, `routes-credential-seam`, `routes-cwd-admission`, `AutomationBoard.test.tsx`). Each gets `await …flushPersistence()` / `await` on store calls. Mechanical, and tracked as tasks.

## Migration Plan

No data or config migration; on-disk records are format-identical (tmp-file naming is transient). Deploy = plugin change + server restart (`npx tsx .pi/skills/implement/scripts/restart-server.ts`). Rollback = revert this change's commit, which contains only this change (the session's earlier `/api/health` fixes are committed separately).
