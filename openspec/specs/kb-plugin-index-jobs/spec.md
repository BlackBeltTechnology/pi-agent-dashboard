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

The dashboard reindex job SHALL resolve each configured source spec on its own through the engine resolver for that spec's kind (`kind`, or the engine `classifyRef` of its `ref` when `kind` is absent). It SHALL use a non-interactive trust check that consults only the persisted trust store, and SHALL index each successfully resolved source.

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
- **THEN** the same directories are indexed with the same options as before this change

#### Scenario: Failure isolated per source

- **WHEN** resolving or indexing one source throws, for example on a network error or a timeout
- **THEN** that source's outcome is recorded as `error` with its message
- **AND** the other sources are still resolved and indexed
- **AND** the job settles with `jobStatus: "error"` and a `lastError` naming the failed source refs, truncated to 500 characters

#### Scenario: Failed or skipped source keeps prior chunks

- **WHEN** a source that was indexed in an earlier run is skipped or fails in the current run
- **THEN** its previously indexed chunks remain in the store

#### Scenario: Per-source outcomes retained

- **WHEN** a reindex job settles
- **THEN** the registry retains each source's last outcome (`ok` | `untrusted` | `error`), error text, resolved revision when known, and completion time

### Requirement: Per-source status endpoint

The kb-plugin server SHALL expose `GET /api/kb/sources?cwd=<abs>`, returning one entry per saved source spec. It SHALL open only an existing store, without initialization or migration, and SHALL issue only read queries. Per-source data SHALL NOT be added to the `/api/kb/stats` response.

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

- **WHEN** `GET /api/kb/stats` is requested
- **THEN** its response fields are exactly those defined before this change
