## ADDED Requirements

### Requirement: Reindex runs in a kb worker thread
The dashboard SHALL run a folder's reindex index work (opening the database, indexing every resolved source, stamping the gate records) in a dedicated `worker_threads` worker that owns its own SQLite handle. The main thread SHALL only resolve sources, schedule the worker, receive progress and log messages and request cancellation, and SHALL NOT write to that database while the worker runs. At most one worker SHALL run per folder. A crashed worker SHALL fail the job without affecting the server.

#### Scenario: Large reindex leaves the main loop responsive
- **WHEN** a forced reindex of a knowledge base of about 50,000 chunks runs
- **THEN** the server main thread's maximum event-loop delay does not exceed 200 ms

#### Scenario: Reads proceed during the worker's writes
- **WHEN** a search or `GET /api/kb/stats` runs while the worker is writing
- **THEN** it reads a consistent snapshot through its own handle without waiting for the worker's batch

#### Scenario: Concurrent request coalesces onto one worker
- **WHEN** a second reindex is requested for a folder whose worker is running
- **THEN** no second worker starts and the response is still `202`

#### Scenario: Worker crash fails the job only
- **WHEN** the worker exits abnormally
- **THEN** the job ends in `error` with a message, the server keeps running and a later reindex can start

#### Scenario: Kill-switch restores in-process indexing
- **WHEN** `PI_DASHBOARD_KB_REINDEX_WORKER=0`
- **THEN** the same indexing core runs on the main thread and the job contract is unchanged

### Requirement: Running reindex can be cancelled
The registry SHALL expose cancellation of a folder's running job via `POST /api/kb/reindex/cancel?cwd=<abs>` (same cwd admission as reindex), on removal of the folder, and on server shutdown. Cancellation SHALL signal the worker, escalate to termination after a grace period, and settle the job as idle with no retained error.

#### Scenario: Cancel a running reindex
- **WHEN** cancel is requested for a folder with a running job
- **THEN** the worker stops, the job settles with `jobStatus: "idle"` and no `lastError`, and committed batches remain

#### Scenario: Cancel with nothing running
- **WHEN** cancel is requested for a folder with no running job
- **THEN** the response is `200` with `cancelled: false` and no state changes

#### Scenario: Unresponsive worker is terminated
- **WHEN** the worker does not stop within the grace period
- **THEN** it is terminated and the job settles as cancelled

### Requirement: Reindex progress and job telemetry
While a job runs, `GET /api/kb/stats` SHALL include an optional `progress` object with the current source root and files done/total, existing fields unchanged. On settling, the server SHALL log one line with mode (`worker` or `inprocess`), files, chunks, wall milliseconds, main-thread maximum event-loop delay and outcome (`ok`, `error`, `cancelled`, `crashed`).

#### Scenario: Stats exposes progress
- **WHEN** stats is polled during a running job after at least one batch committed
- **THEN** the response includes `progress` with `done` and `total`

#### Scenario: Settled job is logged
- **WHEN** a job settles
- **THEN** one log line records mode, wall ms, max event-loop delay and outcome
