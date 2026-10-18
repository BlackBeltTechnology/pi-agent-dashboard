## MODIFIED Requirements

### Requirement: Schema version gate
The store SHALL record, per indexed source, the schema version and an index-options hash it was last indexed with, and a pass SHALL force a full reindex of every source whose recorded values are absent or differ from the current values, then record the current values for each source whose walk completed without error and found the source present. Sources that were skipped (missing or untrusted) or failed SHALL keep their previous record. The index-options hash SHALL cover every configuration input that changes the rows produced for an unchanged file — the frontmatter facet configuration (searchable and facet keys with types) and `includeSourceMarkdown` (an unset value hashing as `true`) — and SHALL NOT cover options that only select which files are indexed (`include`, `exclude`, `extensions`, `respectGitignore`, `indexAgentsFiles`), which the incremental walk already converges. Every writer of a cwd's docs database — the `kb index` CLI, the CLI's auto-index on search, the kb-extension reindex, and the dashboard reindex route — SHALL apply this gate, using the same index options derived from the resolved configuration. After every successful pass the store SHALL also set `PRAGMA user_version` to the current schema version and record the frontmatter-only facet-configuration hash that earlier releases compare, so those releases reading the database do not force a reindex. Existing `chunks`, `nodes`, and `edges` tables SHALL be unaffected by this change.

#### Scenario: Stale version forces reindex
- **WHEN** a source's recorded schema version is older than the current schema version, or its recorded index-options hash differs, or it has no record
- **THEN** that source is fully reindexed to populate the properties store and
  synthetic meta chunks, and its current version and options hash are recorded

#### Scenario: Up-to-date store skips forced reindex
- **WHEN** every source's recorded version and index-options hash match
- **THEN** no forced reindex is triggered by this gate

#### Scenario: Every writer applies the gate
- **GIVEN** a docs database whose sources carry no current record
- **WHEN** the first pass by any writer (CLI index, CLI auto-index, kb-extension reindex, or dashboard reindex) succeeds
- **THEN** every source that writer walked was force-reindexed and now carries the current record

#### Scenario: Skipped source stays due
- **GIVEN** a docs database with two sources, neither carrying a current record
- **WHEN** a dashboard reindex forces the pass and one source is untrusted
- **THEN** only the walked source carries the current record
- **AND** the next pass that walks the other source force-reindexes it

#### Scenario: Changing includeSourceMarkdown forces a reindex
- **WHEN** `includeSourceMarkdown` changes between two passes and no file content changes
- **THEN** the second pass is forced, and the stored document types reflect the new setting

#### Scenario: Changing a selection-only option does not force a reindex
- **WHEN** only `exclude` changes between two passes
- **THEN** the second pass is not forced; newly excluded files are pruned and newly included files are indexed by the incremental walk

#### Scenario: Writers produce identical rows
- **GIVEN** a configuration with custom frontmatter facet keys
- **WHEN** the same file is indexed once by the CLI and once by the kb-extension reindex
- **THEN** both passes write identical chunks and property rows for it

### Requirement: Graph neighbors and backlinks
The store SHALL expose graph traversal from a named node and reverse lookup of nodes linking to it, and SHALL expose chunk retrieval by path that never silently discards matching sections. A node argument SHALL resolve to the node with exactly that name; when no node has that exact name and the argument contains no `#`, it SHALL resolve to every heading node whose heading path equals the argument exactly (no pattern matching), across files. Traversal and reverse lookup SHALL start from the whole resolved set and SHALL exclude every node of that set from the result.

#### Scenario: Neighbors within depth
- **WHEN** the caller requests neighbors of a node with a depth
- **THEN** nodes reachable within that depth are returned, excluding the origin node

#### Scenario: Neighbors filtered by relation
- **WHEN** a relation type is supplied
- **THEN** traversal follows only edges of that relation

#### Scenario: Backlinks
- **WHEN** the caller requests backlinks for a node
- **THEN** the distinct nodes with an edge pointing at it are returned

#### Scenario: File-qualified heading resolves to one file
- **GIVEN** `a.md` and `b.md` both contain a heading `Why`
- **WHEN** the caller requests neighbors of `a.md#Why`
- **THEN** only traversal from `a.md`'s heading is returned

#### Scenario: Bare heading path resolves across files
- **GIVEN** `a.md` and `b.md` both contain a heading `Why`
- **WHEN** the caller requests neighbors of `Why`
- **THEN** traversal starts from both files' `Why` headings and the origin nodes are excluded from the result

#### Scenario: Chunk fetch by path and section
- **WHEN** the caller requests a chunk by path and heading path
- **THEN** the chunk matching that heading path within that file is returned

#### Scenario: Chunk fetch by path alone reports suppressed sections
- **WHEN** the caller requests a chunk by path without a heading path and the file has more than one chunk
- **THEN** the response SHALL indicate that further sections exist and how many
- **AND** the caller SHALL NOT receive an arbitrary single section with no indication that others were omitted

## ADDED Requirements

### Requirement: Cached ranking statistics follow external commits
A store connection that caches statistics derived from the index (such as per-term document frequencies) SHALL discard that cache before using it whenever another connection has committed to the database since the cache was filled.

#### Scenario: Holder ranks with statistics from an external commit
- **GIVEN** a long-lived store connection that has served a search and cached term statistics
- **WHEN** another process commits new chunks to the same database
- **AND** the long-lived connection serves the next search without writing anything itself
- **THEN** that search's ranking uses term statistics that include the new chunks
