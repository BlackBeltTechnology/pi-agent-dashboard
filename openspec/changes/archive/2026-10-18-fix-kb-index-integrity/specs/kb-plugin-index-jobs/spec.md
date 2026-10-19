## MODIFIED Requirements

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
