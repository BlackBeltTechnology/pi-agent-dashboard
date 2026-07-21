# kb-plugin-index-jobs Specification

## Purpose

Provide non-blocking per-folder knowledge-base reindexing. A reindex request is acknowledged immediately while the index walk runs in the background, at most one walk per folder is in flight at a time, and the last outcome of each folder's walk is retained so clients can observe progress and failures by polling folder stats.

## Requirements

### Requirement: Non-blocking reindex acknowledgement

The reindex endpoint SHALL acknowledge a request immediately without waiting for the index walk to finish, and run the walk to completion in the background.

#### Scenario: Reindex returns immediately

- **WHEN** a client sends `POST /api/kb/reindex?cwd=<abs>` for an allowed folder that has no walk in progress
- **THEN** the response is `202` with body `{ status: "running", jobId }`
- **AND** the index walk for that folder proceeds in the background after the response is sent

#### Scenario: Background walk failure is not surfaced in the response

- **WHEN** the background index walk for a folder throws an error
- **THEN** the earlier reindex response is unaffected (already `202`) and no error status is returned from the reindex request
- **AND** the failure is retained for that folder and reported through the stats endpoint

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
