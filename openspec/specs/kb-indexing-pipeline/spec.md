# kb-indexing-pipeline Specification

## Purpose
Build and incrementally maintain a searchable knowledge-base database by walking source directories, detecting changed files, chunking their content and extracting a Tier-1 link graph, and persisting everything through transactional upserts. A first index is produced atomically (temp build then rename) so the target path exists only after a fully successful run.

## Requirements

### Requirement: Source directory walk and file selection
The indexer SHALL recursively walk each configured source directory, select Markdown files, and classify each by doc type, while excluding infrastructure directories and honoring caller-supplied include/exclude filters.

#### Scenario: Recursive Markdown selection
- **WHEN** a source directory is walked
- **THEN** only files with a `.md`, `.mdx`, or `.markdown` extension are collected
- **AND** directories matching the built-in exclusion set (`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.kb`) are skipped

#### Scenario: Include/exclude and extension filters applied
- **WHEN** the caller supplies include globs, exclude globs, or an extensions list
- **THEN** a file is retained only if it matches the include filters (when present)
- **AND** a file matching an exclude glob is dropped

#### Scenario: Doc-type classification
- **WHEN** a selected file is classified
- **THEN** files named `AGENTS.md`, `CLAUDE.md`, or ending in `.AGENTS.md` are typed as `agents`
- **AND** Markdown under a source path (`src`, `lib`, `app`, `packages`) is typed as `source-md` when source-markdown indexing is enabled, otherwise files are typed as `doc`

#### Scenario: Agents files excluded on request
- **WHEN** indexing of agents files is disabled
- **THEN** files classified as `agents` are excluded from the selection

### Requirement: Layered change detection
The indexer SHALL detect changed files using a cheap modification-time check first and a content hash second, skipping unchanged files, unless a full reindex is forced.

#### Scenario: Unchanged mtime short-circuits
- **WHEN** a file's stored modification time equals its on-disk modification time
- **THEN** the file is treated as unchanged and skipped without reading its content

#### Scenario: Content hash confirms no change
- **WHEN** a file's modification time differs but its recomputed SHA-256 content hash equals the stored hash
- **THEN** the file's stored modification time is updated and the file's chunks are left unchanged

#### Scenario: Changed content reindexed
- **WHEN** a file's content hash differs from the stored hash
- **THEN** the file's existing chunks and graph nodes are deleted and it is re-chunked and re-inserted
- **AND** its new modification time and hash are persisted for future incremental runs

#### Scenario: Forced full reindex
- **WHEN** a forced index is requested
- **THEN** modification-time and hash short-circuits are bypassed and every selected file is reprocessed

### Requirement: Chunk and Tier-1 graph extraction
The indexer SHALL split each changed file into structural chunks and extract Tier-1 graph nodes and edges for headings, wikilinks, Markdown links, and frontmatter tags.

#### Scenario: Structural chunking with heading hierarchy
- **WHEN** a changed file is chunked
- **THEN** each chunk is inserted with its heading breadcrumb path and level
- **AND** each heading chunk produces a heading node linked to its parent by a `child_of` edge

#### Scenario: Link and tag edges extracted
- **WHEN** a changed file contains wikilinks, relative Markdown links, or frontmatter tags
- **THEN** wikilinks yield `links_to` edges to normalized target file nodes
- **AND** relative Markdown links yield `references` edges to path-normalized target nodes
- **AND** frontmatter tags yield `has_tag` edges to `tag:<name>` nodes

### Requirement: Batched transactional upsert with cooperative yielding
The indexer SHALL apply changes inside database transactions committed in batches, yielding to the event loop between batches so a concurrent reader observes live progress.

#### Scenario: Periodic batch commit and yield
- **WHEN** the number of files processed since the last yield reaches the batch threshold
- **THEN** the open transaction is committed, control yields to the event loop, and a new transaction begins

#### Scenario: Rollback on mid-batch error
- **WHEN** an error is thrown while processing a file within an open transaction
- **THEN** the current transaction is rolled back and the error is propagated
- **AND** previously committed batches remain persisted, and a re-run completes the index idempotently

### Requirement: Orphan removal for deleted files
The indexer SHALL remove stored files whose paths were not seen during the walk, deleting their chunks, owned graph nodes, dangling edges, and file state.

#### Scenario: Deleted file pruned
- **WHEN** a path recorded in the store for a source is not present on disk during the walk
- **THEN** that path's chunks, nodes, edges, and file-state row are deleted and the deletion is counted

### Requirement: Atomic first index with orphan temp sweep
The indexing orchestration SHALL guarantee that the target database path exists only after a fully successful first index, by building into a process-scoped temp path and renaming on success, and SHALL clean up stale temp husks left by interrupted runs.

#### Scenario: First index builds into temp then renames
- **WHEN** the target database path does not yet exist
- **THEN** indexing writes into a `<dbPath>.tmp-<pid>` file and, on success, checkpoints and renames it onto the target path
- **AND** an interrupted first index leaves only a temp orphan, never the real target path

#### Scenario: Incremental index runs in place
- **WHEN** a valid target database already exists
- **THEN** indexing occurs in place to preserve in-database file-state for incremental skipping
- **AND** a mid-run failure leaves the prior database valid and queryable

#### Scenario: Failed first-index cleanup
- **WHEN** a run that created the database file fails
- **THEN** that run closes and unlinks its temp file and WAL sidecars, and a pre-existing valid database is never removed

#### Scenario: Orphan temp sweep skips live peers
- **WHEN** the orchestration starts and finds stale `<dbPath>.tmp-*` files
- **THEN** temp files whose embedded PID names a dead process are removed
- **AND** a temp file whose PID names a live process is left untouched

#### Scenario: Missing source directories handled
- **WHEN** an explicitly requested source directory does not exist
- **THEN** the run fails before any store is opened
- **AND** a configured (non-explicit) source that is absent is skipped with a warning, while an entirely absent source set fails before any store is opened
