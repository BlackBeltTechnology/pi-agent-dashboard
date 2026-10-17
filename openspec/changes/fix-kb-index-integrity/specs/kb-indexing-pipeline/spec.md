## MODIFIED Requirements

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
- **THEN** the rows the file owns (its chunks, heading nodes, outbound edges and property rows) are deleted and it is re-chunked and re-inserted, while its file node and other files' edges to it are kept
- **AND** its new modification time and hash are persisted for future incremental runs

#### Scenario: Forced full reindex
- **WHEN** a forced index is requested
- **THEN** modification-time and hash short-circuits are bypassed and every selected file is reprocessed

### Requirement: Chunk and Tier-1 graph extraction
The indexer SHALL split each changed file into structural chunks and extract
Tier-1 graph nodes and edges for headings, wikilinks, Markdown links, and
frontmatter tags. For each changed file it SHALL additionally emit a synthetic
searchable meta chunk when configured searchable frontmatter is present, and write
structured property rows for configured facet keys. The frontmatter graph emit
SHALL remain limited to `tags → has_tag`; this requirement does NOT widen the
`edges.rel` or graph node-type unions.

A heading node SHALL be identified by its file and heading path together
(`<file path>#<heading path>`), so headings with the same text in different files
are distinct nodes. Re-chunking a changed file SHALL replace only what that file
owns: its chunks, its heading nodes, its property rows, and the edges whose source
is its file node or one of its heading nodes (outbound edges). The file's own
`file` node SHALL persist across the re-chunk, so edges owned by other files that
point at it (inbound edges) SHALL survive unchanged.

#### Scenario: Structural chunking with heading hierarchy
- **WHEN** a changed file is chunked
- **THEN** each chunk is inserted with its heading breadcrumb path and level
- **AND** each heading chunk produces a heading node linked to its parent by a
  `child_of` edge

#### Scenario: Link and tag edges extracted
- **WHEN** a changed file contains wikilinks, relative Markdown links, or
  frontmatter tags
- **THEN** wikilinks yield `links_to` edges to normalized target file nodes
- **AND** relative Markdown links yield `references` edges to path-normalized
  target nodes
- **AND** frontmatter tags yield `has_tag` edges to `tag:<name>` nodes

#### Scenario: Synthetic meta chunk and property rows
- **WHEN** a changed file carries configured searchable or facet frontmatter keys
- **THEN** a synthetic meta chunk is inserted for the searchable values, and one
  property row per facet key/value (one per element for arrays) is written
- **AND** `docType` is mirrored into the properties store so it is uniformly
  facetable
- **AND** any top-level `kb:` block is excluded from all of the above

#### Scenario: Same heading text in two files yields two nodes
- **GIVEN** `a.md` and `b.md` both contain a top-level heading `Why`
- **WHEN** both are indexed
- **THEN** there are two heading nodes, `a.md#Why` and `b.md#Why`, each with a `child_of` edge to its own file node

#### Scenario: Re-chunking one file leaves another file's headings intact
- **GIVEN** `a.md` and `b.md` both contain a heading `Why` and both are indexed
- **WHEN** only `a.md` changes and is re-chunked
- **THEN** `b.md#Why` and its `child_of` edge are unchanged

#### Scenario: Inbound edges survive re-chunking the target
- **GIVEN** an indexed file `a.md` containing a relative Markdown link to `b.md`, and an indexed `b.md`
- **WHEN** only `b.md` changes and is re-chunked
- **THEN** the `references` edge from `a.md` to `b.md` is still present
- **AND** a backlinks query for `b.md` still returns `a.md`

#### Scenario: Outbound edges are replaced on re-chunk
- **GIVEN** an indexed `a.md` linking to `b.md`
- **WHEN** `a.md` is edited to link to `c.md` instead and is re-chunked
- **THEN** `a.md` has a `references` edge to `c.md` and none to `b.md`

### Requirement: Orphan removal for deleted files
The indexer SHALL remove stored files whose paths were not seen during the walk,
deleting their chunks, heading nodes, outbound edges, property rows, synthetic
meta chunk, and file state. The deleted file's `file` node SHALL be demoted to an
unindexed placeholder (no owning path) rather than removed, so edges owned by
other files that still point at it are kept, exactly as for a link to a file that
was never indexed. At the end of each walk, every node without an owning path
(file placeholders and tag nodes) that no edge references SHALL be removed. A file that disappears between enumeration and being
read SHALL be treated as deleted rather than failing the pass.

#### Scenario: Deleted file pruned
- **WHEN** a path recorded in the store for a source is not present on disk during
  the walk
- **THEN** that path's chunks (including its synthetic meta chunk), heading nodes,
  outbound edges, property rows, and file-state row are deleted and the deletion is
  counted

#### Scenario: Links to a deleted file are kept as placeholder links
- **GIVEN** an indexed `a.md` linking to an indexed `b.md`
- **WHEN** `b.md` is deleted and the walk prunes it
- **THEN** the `references` edge from `a.md` still exists and now targets a placeholder `b.md` node with no owning path

#### Scenario: Unreferenced placeholders are swept
- **GIVEN** a placeholder node that no edge references
- **WHEN** a walk completes
- **THEN** the placeholder node no longer exists

#### Scenario: Tag removed from its last file is swept
- **GIVEN** `a.md` is the only file with frontmatter tag `x`
- **WHEN** the tag is removed from `a.md` and the walk completes
- **THEN** no `tag:x` node remains

#### Scenario: File vanishing mid-walk is treated as deleted
- **WHEN** a file enumerated by the walk no longer exists when the indexer stats or reads it
- **THEN** the pass continues with the remaining files
- **AND** the vanished file's stored rows are removed as for a deleted file

#### Scenario: Reindex does not duplicate property rows
- **WHEN** a changed file is re-indexed
- **THEN** its prior property rows and synthetic meta chunk are removed before the
  new ones are written, so no duplicate property rows accumulate

### Requirement: Atomic first index with orphan temp sweep
The indexing orchestration SHALL guarantee that the target database path exists only after a fully successful first index, by building into a process-scoped temp path and installing it on success, and SHALL clean up stale temp husks left by interrupted runs. Every writer that finds the docs database absent — the `kb index` CLI, the CLI's other commands, the kb-extension's cold-start populate and reindex, and the dashboard reindex job — SHALL create it only through this first-index path, never by opening the target path in place. While another process's first index is live, the CLI's other commands SHALL print `(index is still being built — no results available yet; retry shortly)` and exit with status 75. Each install SHALL write one log line to standard error: `[kb] install=<link|rename|backup> retries=<n> ms=<n>` on success, `[kb] install-failed=<busy-timeout|backup-error:<errcode>|build-error> retries=<n> ms=<n>` on failure. Installing SHALL never overwrite an existing target path through the filesystem: the temp database SHALL be placed at the target path with an atomic create-if-absent operation, and when the target path already exists its contents SHALL be copied into the target through the SQLite online backup API, so connections other processes hold on the target observe the new contents and no stale write-ahead log is applied to them. When the atomic create-if-absent operation is unsupported by the filesystem, the target SHALL be re-checked and the temp file renamed onto it only if it is still absent (otherwise the backup install applies). A `<dbPath>.tmp-<pid>` file SHALL denote a live first index (the live-build marker) exactly when its PID names a live process and the newest modification time of the temp file or its write-ahead log lies between 0 and 120 seconds in the past; a live build SHALL refresh that modification time at least every 30 seconds, including within a batch. A run SHALL never remove a file it did not create: when a writer that does not honour the marker created the target during the build and the run then fails — the build throws, or the backup install cannot complete within its retry bound or fails otherwise — the run SHALL exit non-zero and leave the target as that writer's database.

#### Scenario: First index builds into temp then renames
- **WHEN** the target database path does not yet exist
- **THEN** indexing writes into a `<dbPath>.tmp-<pid>` file and, on success, checkpoints and closes it
- **AND** places it at the target path with an atomic create-if-absent operation and removes the temp name
- **AND** an interrupted first index leaves only a temp orphan, never the real target path

#### Scenario: Target created by another process during the build
- **GIVEN** a first index is building into `<dbPath>.tmp-<pid>`
- **AND** a writer that does not honour the live-build marker creates and holds open `dbPath`, writing to its write-ahead log, before the build finishes
- **WHEN** the build succeeds
- **THEN** the built contents are copied into `dbPath` through the backup API
- **AND** a fresh reader of `dbPath` sees the built file count, chunk count and schema version
- **AND** the holding connection reads the built contents on its next query

#### Scenario: Backup install retries while the target is write-locked
- **WHEN** the backup install finds the target write-locked by another connection
- **THEN** it retries with backoff for at most 30 seconds in total and succeeds once the lock is released
- **AND** if the bound elapses it exits non-zero, removes its temp file, and leaves the target as the other process's database

#### Scenario: Non-busy backup error is not retried
- **WHEN** the backup install fails with an error other than the destination being busy or locked
- **THEN** the run fails at once without retrying, removes its temp file, and leaves the target in place

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
- **AND** a temp file whose PID names a live process is left untouched unless its newest modification time is more than one hour old

#### Scenario: Recycled PID on a stale temp is not a live build
- **GIVEN** a `<dbPath>.tmp-<pid>` whose PID names a live but unrelated process and whose files were last modified more than 120 seconds ago
- **WHEN** the live-build marker is evaluated
- **THEN** it is not live, so creators are not held back by it

#### Scenario: Session cold populate builds through the first-index path
- **GIVEN** a cwd with no docs database
- **WHEN** a pi session's first `kb_search` populates the index
- **THEN** the build runs in `<dbPath>.tmp-<pid>` and `dbPath` appears only when the build has succeeded
- **AND** a session killed mid-build leaves no file at `dbPath`

#### Scenario: Slow live build stays live
- **GIVEN** a first index whose current batch takes longer than 120 seconds
- **WHEN** the live-build marker is evaluated during that batch
- **THEN** it is live

#### Scenario: Missing source directories handled
- **WHEN** an explicitly requested source directory does not exist
- **THEN** the run fails before any store is opened
- **AND** a configured (non-explicit) source that is absent is skipped with a warning, while an entirely absent source set fails before any store is opened

## ADDED Requirements

### Requirement: Index-addressed per-file row replacement
The store SHALL record, for every docs chunk it inserts, the chunk's row id under the chunk's source and path, and SHALL delete a file's chunks by those recorded row ids rather than by a scan over the chunk table, deleting a recorded row only while it still belongs to that source and path. The store SHALL rebuild the record from the chunk table, atomically and before any per-file deletion, at the start of a connection's first pass and of every pass after another connection has committed to the database, because writers that do not keep the record may have inserted chunks or reused row ids; a rebuild failure SHALL abort the pass. In the same step, files whose heading nodes are not file-qualified SHALL be marked for re-chunking. A forced pass SHALL replace rows file by file in place, so no file is ever left without rows: files in batches committed before a failure hold their re-chunked rows and the rest hold their prior rows; a source that fails, is missing, or is untrusted keeps its rows.

#### Scenario: Per-file replacement deletes exactly the file's chunks
- **WHEN** one file is re-chunked
- **THEN** its prior chunks, including its synthetic meta chunk, are deleted and no other file's chunks are touched

#### Scenario: Pre-existing database is backfilled
- **GIVEN** a populated docs database with no recorded chunk row ids
- **WHEN** a store opens it and a file is re-chunked
- **THEN** that file's prior chunks are deleted and no duplicate chunks for it remain

#### Scenario: Legacy heading names are re-chunked
- **GIVEN** a docs database in which an earlier kb release re-chunked `a.md`, writing bare heading node names
- **WHEN** the current store runs its next pass and `a.md` is unchanged on disk
- **THEN** `a.md` is re-chunked and its heading nodes are file-qualified

#### Scenario: Concurrent writer during the record rebuild
- **WHEN** another connection inserts chunks while a pass rebuilds the record
- **THEN** the pass either completes with a record covering every chunk or aborts before any per-file deletion, and no file ends with duplicate chunks

#### Scenario: Chunks written without the record are re-recorded
- **GIVEN** a docs database whose record is current
- **WHEN** an earlier kb release deletes one file's chunks and inserts another file's chunks into it, and the current store then re-chunks both files
- **THEN** neither file has duplicate chunks and neither file's chunks were deleted on behalf of the other

#### Scenario: Forced pass equals a first index
- **WHEN** a forced pass runs over an existing populated database
- **THEN** the resulting files, chunks, properties, nodes and edges equal those of a first index of the same tree

#### Scenario: Forced pass failing part-way leaves no file without rows
- **GIVEN** a populated docs database
- **WHEN** a forced pass over one source throws after processing some of its files
- **THEN** every file of that source still has chunks: re-chunked for files in committed batches, prior for the rest
