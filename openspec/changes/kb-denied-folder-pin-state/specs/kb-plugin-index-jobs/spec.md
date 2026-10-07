## MODIFIED Requirements

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
