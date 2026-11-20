## ADDED Requirements

### Requirement: Reindex runs in a kb worker thread
The dashboard SHALL run a folder's reindex index work (opening the database, indexing every resolved source, stamping the gate records) in a dedicated `worker_threads` worker that owns its own SQLite handle. The main thread SHALL only resolve sources, schedule the worker, receive progress and log messages and request cancellation, and SHALL NOT write to that database while the worker runs. At most one worker SHALL run per folder. A crashed worker SHALL fail the job without affecting the server.

#### Scenario: Large reindex leaves the main loop responsive
- **WHEN** a forced reindex of a knowledge base of about 50,000 chunks runs
- **THEN** the server main thread's maximum event-loop delay does not exceed 200 ms

#### Scenario: Reads proceed during the worker's writes
- **WHEN** a search or `GET /api/kb/stats` runs while the worker is writing
- **THEN** it succeeds (no error, no `SQLITE_BUSY`) and reads a consistent snapshot through its own handle without waiting for the worker's batch

#### Scenario: Concurrent request coalesces onto one worker
- **WHEN** a second reindex is requested for a folder whose worker is running
- **THEN** no second worker starts and the response is still `202`

#### Scenario: Worker crash fails the job only
- **WHEN** the worker exits abnormally
- **THEN** the job ends in `error` with a message, the server keeps running and a later reindex can start

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

#### Scenario: Progress absent when idle
- **WHEN** no job is running for the folder
- **THEN** the stats response has no `progress` field

#### Scenario: Settled job is logged
- **WHEN** a job settles
- **THEN** one log line records mode, wall ms, max event-loop delay and outcome

## MODIFIED Requirements

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
