## ADDED Requirements

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
