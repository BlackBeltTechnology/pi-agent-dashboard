# kb-plugin-index-jobs Specification

## Purpose

Provide non-blocking per-folder knowledge-base reindexing. A reindex request is acknowledged immediately while the index walk runs in the background, at most one walk per folder is in flight at a time, and the last outcome of each folder's walk is retained so clients can observe progress and failures by polling folder stats.

## Requirements

### Requirement: Non-blocking reindex acknowledgement

The reindex endpoint SHALL acknowledge a request immediately without waiting for the index walk to finish, and run the walk to completion in the background. A request for a folder that does not exist, or whose resolved config has zero source specs, SHALL be refused with `409` before any job is registered.

#### Scenario: Reindex returns immediately

- **WHEN** a client sends `POST /api/kb/reindex?cwd=<abs>` for an allowed, existing folder with at least one configured source and no walk in progress
- **THEN** the response is `202` with body `{ status: "running", jobId }`
- **AND** the index walk for that folder proceeds in the background after the response is sent

#### Scenario: Background walk failure is not surfaced in the response

- **WHEN** the background index walk for a folder throws an error
- **THEN** the earlier reindex response is unaffected (already `202`) and no error status is returned from the reindex request
- **AND** the failure is retained for that folder and reported through the stats endpoint

#### Scenario: Unindexable folder is refused, not acknowledged

- **WHEN** a client sends `POST /api/kb/reindex?cwd=<abs>` for an allowed folder that does not exist, or whose resolved config has zero source specs
- **THEN** the response is `409` with `{ error: "folder missing" }` or `{ error: "no sources configured" }` respectively
- **AND** no job is registered for that folder and its job status is unchanged

#### Scenario: Chained reindex after a config save honours the same preconditions

- **WHEN** a config save that requests a reindex leaves the folder with zero source specs
- **THEN** no job is registered and the save response reports the reindex as skipped

### Requirement: Per-folder coalescing

The reindex job registry SHALL run at most one index walk per folder at a time, coalescing a request that arrives while a walk for the same folder is already in progress onto the existing walk.

#### Scenario: Concurrent reindex does not start a second walk

- **WHEN** a folder already has an index walk in progress and another `POST /api/kb/reindex?cwd=<abs>` arrives for the same folder
- **THEN** no second walk is started for that folder
- **AND** the response is still `202` with `{ status: "running", jobId }`

#### Scenario: Independent folders run independently

- **WHEN** reindex is requested for two different folders
- **THEN** each folder runs its own walk without coalescing onto the other

### Requirement: Job status and error retention

The registry SHALL retain the last outcome of each folder's walk and expose it through folder stats, reporting a running walk, a retained failure until a later success clears it, and otherwise idle.

#### Scenario: Stats reports a running walk

- **WHEN** a client sends `GET /api/kb/stats?cwd=<abs>` while that folder's walk is in progress
- **THEN** the response includes `indexing: true` and `jobStatus: "running"`

#### Scenario: Stats reports a retained failure

- **WHEN** a folder's most recent walk failed and no walk is currently running
- **THEN** `GET /api/kb/stats?cwd=<abs>` returns `jobStatus: "error"` and a `lastError` message

#### Scenario: A later success clears the retained failure

- **WHEN** a folder whose last walk failed completes a new walk successfully
- **THEN** `GET /api/kb/stats?cwd=<abs>` returns `jobStatus: "idle"` with no `lastError`

#### Scenario: Idle when never run or last walk succeeded

- **WHEN** a folder has no walk running and either never ran a walk or last completed one successfully
- **THEN** `GET /api/kb/stats?cwd=<abs>` returns `jobStatus: "idle"`

### Requirement: Completion observed via stats polling

Clients SHALL observe reindex progress and completion by polling folder stats rather than from the reindex response, treating `indexing` as the signal to keep polling.

#### Scenario: Poll until the walk settles

- **WHEN** a client receives the `202` reindex acknowledgement and then polls `GET /api/kb/stats?cwd=<abs>`
- **THEN** the client continues polling while `indexing` is `true`
- **AND** stops polling once stats report `indexing: false`

#### Scenario: Cwd guarded on every request

- **WHEN** a reindex or stats request supplies a `cwd` that is not an allowed known folder
- **THEN** the request is rejected with `403` (or `400` when `cwd` is missing) and no walk is started

### Requirement: Dashboard reindex resolves every configured source kind

The dashboard reindex job SHALL resolve each configured source spec on its own through the engine resolver for that spec's kind (`kind`, or the engine `classifyRef` of its `ref` when `kind` is absent). It SHALL use a non-interactive trust check that consults only the persisted trust store, and SHALL index each successfully resolved source. It SHALL index with the full option set derived from the resolved configuration (including the frontmatter facet configuration) and SHALL apply the store's per-source schema-version / options-hash gate, exactly as the `kb index` CLI does, recording the current values only for sources whose outcome is `ok` and whose directory was present. While the folder's docs database does not exist and another process's first index is live (a live-build marker `<dbPath>.tmp-<pid>` exists), the job SHALL NOT create the docs database; it SHALL wait while that marker stays live — reporting `jobStatus: "running"` and `indexing: true` for the whole wait — and then walk the database the first index produced or, if that first index ended without producing one, build the folder's first index itself. A job that finds the docs database absent SHALL build it through the atomic first-index path.

#### Scenario: Trusted remote source indexed

- **GIVEN** a folder config lists a `git` source whose spec is recorded as trusted
- **WHEN** a reindex job runs
- **THEN** the source is resolved into the source cache and its markdown is indexed under `root === ref`

#### Scenario: Untrusted remote source skipped, not fatal

- **GIVEN** a folder config lists a remote source that is not trusted
- **WHEN** a reindex job runs
- **THEN** no network fetch occurs for that source
- **AND** its outcome is recorded as `untrusted`
- **AND** the remaining sources are still indexed
- **AND** the job does not enter `jobStatus: "error"` on account of that source

#### Scenario: Kind-less remote ref classified by prefix

- **GIVEN** a saved source `{ ref: "https://host/doc.md" }` with no `kind`
- **WHEN** a reindex job runs
- **THEN** it is handled as an `https` source and is subject to the trust check

#### Scenario: Filesystem sources unchanged

- **GIVEN** a config containing only filesystem sources
- **WHEN** a reindex job runs
- **THEN** the same directories are indexed with the same index options the `kb index` CLI derives from that config, including the frontmatter facet configuration

#### Scenario: Failure isolated per source

- **WHEN** resolving or indexing one source throws, for example on a network error or a timeout
- **THEN** that source's outcome is recorded as `error` with its message
- **AND** the other sources are still resolved and indexed
- **AND** the job settles with `jobStatus: "error"` and a `lastError` naming the failed source refs, truncated to 500 characters

#### Scenario: Failed or skipped source keeps prior chunks

- **WHEN** a source that was indexed in an earlier run is skipped or fails in the current run
- **THEN** its previously indexed chunks remain in the store, including when the gate forces the run

#### Scenario: Per-source outcomes retained

- **WHEN** a reindex job settles
- **THEN** the registry retains each source's last outcome (`ok` | `untrusted` | `error`), error text, resolved revision when known, and completion time

#### Scenario: Stale schema stamp converged by a dashboard reindex

- **GIVEN** the folder's docs database carries no current per-source record
- **WHEN** a reindex job settles
- **THEN** every source whose outcome is `ok` carries the current schema version and options hash record

#### Scenario: Errored or untrusted source stays due

- **GIVEN** the folder's docs database carries no current per-source record
- **WHEN** a reindex job settles with one source `error` or `untrusted`
- **THEN** that source's record is unchanged, so the next pass that walks it is forced

#### Scenario: Reindex job waits for a live first index

- **GIVEN** the folder has no docs database and another live process is building `<dbPath>.tmp-<pid>`
- **WHEN** a reindex job is requested
- **THEN** the request is acknowledged as for any reindex and no file is created at `dbPath` by the job
- **AND** once the first index finishes, the job walks the produced database and settles with its per-source outcomes

#### Scenario: Awaited first index dies

- **GIVEN** a reindex job waiting on another process's first index
- **WHEN** that process exits without producing a database and the marker stops being live
- **THEN** the job builds the folder's first index through the atomic first-index path and settles with its per-source outcomes

### Requirement: Per-source status endpoint

The kb-plugin server SHALL expose `GET /api/kb/sources?cwd=<abs>`, returning one entry per saved source spec. It SHALL open only an existing store, without initialization or migration, and SHALL issue only read queries. Per-source data SHALL NOT be added to the `/api/kb/stats` response; the only per-job addition permitted there is the transient `progress` object defined by "Reindex progress and job telemetry".

#### Scenario: Source status shape

- **WHEN** an admitted `cwd` is requested
- **THEN** the response is `200 { sources }`
- **AND** each entry carries `ref`, `kind`, `files`, `trusted` (`null` for filesystem), and `outside` (true for a filesystem ref resolving outside `cwd`)
- **AND** it carries `lastStatus`, `lastError`, `revision`, and `lastAt` when a prior job recorded them

#### Scenario: Unindexed source counts zero

- **WHEN** a configured source has no indexed files, or the folder has no store file
- **THEN** its `files` value is 0 and no store file is created

#### Scenario: Outside test respects path boundaries

- **GIVEN** `cwd` is `/a/b`
- **WHEN** a filesystem source resolves to `/a/bc`
- **THEN** `outside` is true
- **AND** a source resolving to `/a/b/docs` has `outside` false

#### Scenario: Stats shape unchanged

- **WHEN** `GET /api/kb/stats` is requested while no job is running
- **THEN** its response fields are exactly those defined before this change
- **AND** while a job runs the only added field is the transient `progress` object

### Requirement: Reindex runs in a kb worker thread
The dashboard SHALL run a folder's reindex index work in a dedicated `worker_threads` worker that owns its own SQLite handle. The main thread SHALL only resolve sources, schedule the worker, receive progress and log messages and request cancellation, and SHALL NOT write to that database while the worker runs. At most one worker SHALL run per folder. A crash after ready SHALL fail only the job; a load failure before ready SHALL fall back in-process.

#### Scenario: Large reindex leaves the main loop responsive
- **WHEN** a forced reindex of a knowledge base of about 50,000 chunks runs
- **THEN** the server main thread's maximum event-loop delay does not exceed 200 ms
- **AND** this threshold is asserted by an opt-in measurement test (`KB_MEASURE=1`, run at ship time, result recorded in `design.md`), not by the default test suite

#### Scenario: Reads proceed during the worker's writes
- **WHEN** a search or `GET /api/kb/stats` runs while the worker is writing
- **THEN** it succeeds (no error, no `SQLITE_BUSY`) and reads a consistent snapshot through its own handle without waiting for the worker's batch

#### Scenario: Concurrent request coalesces onto one worker
- **WHEN** a second reindex is requested for a folder whose worker is running
- **THEN** no second worker starts and the response is still `202`

#### Scenario: Worker crash fails the job only
- **WHEN** the worker exits abnormally after it reported ready
- **THEN** the job ends in `error` with a message, the server keeps running and a later reindex can start

#### Scenario: Worker load failure falls back in-process
- **WHEN** the worker fails to load (bootstrap or import error) before it reports ready
- **THEN** that job runs in-process through the same indexing core and ends as it would have in worker mode
- **AND** a warning naming the load failure is logged and the job's log line records `mode=inprocess`
- **AND** a later reindex tries the worker again

#### Scenario: Config edited between resolve and worker load
- **WHEN** the folder's configuration changes after the main thread resolved the sources but before the worker loads it
- **THEN** the job fails with a clear message and nothing is indexed under the mismatched gate

#### Scenario: Killed first-index worker leaves no temp file
- **GIVEN** a worker building a first index into a temporary database file
- **WHEN** the worker is terminated or crashes mid-build
- **THEN** the temporary database file and its sidecars are removed without a server restart

#### Scenario: Kill-switch restores in-process indexing
- **WHEN** `PI_DASHBOARD_KB_REINDEX_WORKER=0`
- **THEN** the same indexing core runs on the main thread and the job contract is unchanged

### Requirement: Running reindex can be cancelled
A folder's running job SHALL be cancellable via `POST /api/kb/reindex/cancel?cwd=<abs>` (same cwd admission), on folder removal and on server shutdown. Cancel SHALL stop the run (terminating after a grace period, at once on shutdown), including a wait for another process's first index, and restore the pre-start job state, so it neither creates nor clears a retained failure. A reindex requested meanwhile SHALL start after the cancelled job settles.

#### Scenario: Cancel a running reindex
- **WHEN** cancel is requested for a folder with a running job
- **THEN** the worker stops, the job settles with `jobStatus: "idle"` and no `lastError` (when no failure was retained before the run), and committed batches remain
- **AND** no per-source error outcome and no pass-complete stamp is recorded for the aborted run, and sources not yet started are untouched

#### Scenario: Cancel keeps a previously retained failure
- **GIVEN** a folder whose last walk failed and is retained as `jobStatus: "error"` with a `lastError`
- **WHEN** a new reindex is started and then cancelled
- **THEN** the settled state is again `jobStatus: "error"` with the earlier `lastError`

#### Scenario: Cancel while waiting for another process's first index
- **GIVEN** a job waiting for another process's live first index
- **WHEN** cancel is requested
- **THEN** the wait ends immediately and the job settles as idle

#### Scenario: Folder removal cancels
- **WHEN** the folder disappears while its job is running
- **THEN** the job is cancelled and settles idle with no `lastError`

#### Scenario: Server shutdown cancels
- **WHEN** the server shuts down while a worker is running
- **THEN** the worker is terminated without waiting out the grace period

#### Scenario: Repeated cancel is idempotent
- **GIVEN** a job whose cancellation is in progress (grace period not elapsed)
- **WHEN** cancel is requested again
- **THEN** the response is `200` with `cancelled: true`, no second termination is scheduled and `GET /api/kb/stats` still reports `jobStatus: "running"` (no new status value) until the job settles

#### Scenario: Cancel keeps an already completed source's stamp
- **GIVEN** a multi-source pass in which source A completed and was stamped and source B is running
- **WHEN** cancel is requested during B
- **THEN** A's per-source stamp is kept, B and the pass receive no stamp, and a later run completes indexing only changed files

#### Scenario: Reindex requested during cancellation
- **WHEN** a reindex request arrives for a folder whose job is being cancelled
- **THEN** a new job starts after the cancelled job settles and the request is not dropped

#### Scenario: Cancel with nothing running
- **WHEN** cancel is requested for a folder with no running job
- **THEN** the response is `200` with `cancelled: false` and no state changes

#### Scenario: Unresponsive worker is terminated
- **WHEN** the worker does not stop within the grace period
- **THEN** it is terminated and the job settles as cancelled

### Requirement: Reindex progress and job telemetry
While a job runs, `GET /api/kb/stats` SHALL include an optional transient `progress` object with the current source root and files done/total, existing fields unchanged. On settling, the server SHALL log one line with mode (`worker` or `inprocess`), files, chunks, wall milliseconds, main-thread maximum event-loop delay and outcome (`ok`, `error`, `cancelled`, `crashed`).

#### Scenario: Stats exposes progress
- **WHEN** stats is polled during a running job after at least one batch committed
- **THEN** the response includes `progress` with `done` and `total`

#### Scenario: Progress absent before the first batch commits
- **WHEN** stats is polled during a running job before any batch has committed
- **THEN** the response has no `progress` field

#### Scenario: Progress absent when idle
- **WHEN** no job is running for the folder
- **THEN** the stats response has no `progress` field

#### Scenario: Settled job is logged
- **WHEN** a job settles
- **THEN** one log line records mode, wall ms, max event-loop delay and outcome
