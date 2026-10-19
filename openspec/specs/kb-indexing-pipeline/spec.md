# kb-indexing-pipeline Specification

## Purpose
Build and incrementally maintain a searchable knowledge-base database by walking source directories, detecting changed files, chunking their content and extracting a Tier-1 link graph, and persisting everything through transactional upserts. A first index is produced atomically (temp build then rename) so the target path exists only after a fully successful run.

## Requirements

### Requirement: Source directory walk and file selection
The indexer SHALL recursively walk each configured source directory, select Markdown and AsciiDoc files, and classify each by doc type, while excluding infrastructure directories and honoring caller-supplied include/exclude filters. The built-in exclusion set SHALL cover nested git worktree checkouts (`.worktrees`) regardless of whether the repository ignores that directory, aligning that entry with the DOX tree walk's exclusion set (which keeps further DOX-specific entries of its own). A directory excluded by the built-in set SHALL NOT be re-admitted by caller-supplied include filters or by a gitignore negation, consistently with the other built-in entries. Default include and extension filters SHALL admit AsciiDoc files, and each selected file SHALL be dispatched to the chunker matching its extension (markdown chunker for `.md`/`.mdx`/`.markdown`, AsciiDoc chunker for `.adoc`/`.asciidoc`).

#### Scenario: Recursive Markdown selection
- **WHEN** a source directory is walked
- **THEN** only files with a `.md`, `.mdx`, `.markdown`, `.adoc`, or `.asciidoc` extension are collected
- **AND** directories matching the built-in exclusion set (`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `.kb`, `.worktrees`) are skipped

#### Scenario: Non-ignored worktree directory is still excluded
- **WHEN** a source contains a `.worktrees` directory that no `.gitignore` rule covers
- **THEN** no file under it is selected, and it is not descended into while gitignore patterns are collected

#### Scenario: A built-in exclusion cannot be re-admitted
- **WHEN** a caller supplies an include glob matching a path under `.worktrees`, or a `.gitignore` negation would re-include it
- **THEN** the path remains excluded, because the built-in set is evaluated before include filters and gitignore verdicts

#### Scenario: Include/exclude and extension filters applied
- **WHEN** the caller supplies include globs, exclude globs, or an extensions list
- **THEN** a file is retained only if it matches the include filters (when present)
- **AND** a file matching an exclude glob is dropped

#### Scenario: Default filters admit AsciiDoc
- **WHEN** no caller-supplied include or extensions filters are present
- **THEN** the default configuration retains `.adoc` and `.asciidoc` files in addition to markdown

#### Scenario: Per-extension chunker dispatch
- **WHEN** a selected `.adoc` or `.asciidoc` file is indexed
- **THEN** it is chunked by the AsciiDoc chunker
- **AND** markdown files continue to be chunked by the markdown chunker
- **AND** a title fallback derived from the file name strips the `.adoc`/`.asciidoc` extension

#### Scenario: Doc-type classification
- **WHEN** a selected file is classified
- **THEN** files named `AGENTS.md`, `CLAUDE.md`, or ending in `.AGENTS.md` are typed as `agents`
- **AND** Markdown or AsciiDoc under a source path (`src`, `lib`, `app`, `packages`) is typed as `source-md` when source-markdown indexing is enabled, otherwise files are typed as `doc`

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

### Requirement: Batched transactional upsert with cooperative yielding
The indexer SHALL apply changes inside database transactions committed in batches, yielding to the event loop between batches so a concurrent reader observes live progress. The directory walk that precedes those batches, and the gitignore pattern pre-scan that precedes the walk, SHALL likewise yield to the event loop after a fixed number of directory entries (and also once a fixed short wall-clock interval has elapsed since the last yield, so a slow filesystem with few entries per directory cannot starve the loop), so that no part of an indexing pass occupies the runtime continuously for the duration of the traversal, however many directories the tree contains. Listing a single directory remains one blocking call; the bound is per entries processed, not within one directory listing. The synchronous and yielding gitignore loaders SHALL share one per-directory descend rule so their collected patterns cannot diverge. The yield threshold SHALL be a single named constant shared by both traversals, so the behaviour is testable against one number. Yielding SHALL NOT change which files are selected or which gitignore patterns are collected.

#### Scenario: Periodic batch commit and yield
- **WHEN** the number of files processed since the last yield reaches the batch threshold
- **THEN** the open transaction is committed, control yields to the event loop, and a new transaction begins

#### Scenario: Walk yields during a large tree
- **WHEN** the directory walk visits more entries than the walk yield threshold
- **THEN** control is returned to the event loop each time the threshold is reached
- **AND** other scheduled work (timers, socket traffic, concurrent tool calls) proceeds while the walk continues

#### Scenario: Event-loop stalls stay bounded during the traversal
- **WHEN** an indexing pass walks and pre-scans a tree of several thousand directories, none of which is individually a very wide listing
- **THEN** the maximum observed event-loop delay during the pass does not exceed 250 ms

#### Scenario: Gitignore pre-scan yields during a large tree
- **WHEN** the gitignore pattern pre-scan for an indexing pass descends more directories than the yield threshold
- **THEN** control is returned to the event loop each time the threshold is reached, before the walk begins
- **AND** the collected pattern set is identical to the set collected without yielding

#### Scenario: Sync and yielding gitignore loaders agree
- **WHEN** the synchronous and the yielding gitignore loaders scan the same tree (including nested `.gitignore` files, negations, an ignored parent carrying its own `.gitignore`, and a pruned directory)
- **THEN** both collect the same patterns in the same order

#### Scenario: Walk selection is unaffected by yielding
- **WHEN** the same tree is walked with and without yielding
- **THEN** the selected file set is identical, in the same order

#### Scenario: Rollback on mid-batch error
- **WHEN** an error is thrown while processing a file within an open transaction
- **THEN** the current transaction is rolled back and the error is propagated
- **AND** previously committed batches remain persisted, and a re-run completes the index idempotently

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
The indexing orchestration SHALL guarantee that the target database path exists only after a fully successful first index, by building into a process-scoped temp path and installing it on success, and SHALL clean up stale temp husks left by interrupted runs. Every writer that finds the docs database absent — the `kb index` CLI, the CLI's other commands, the kb-extension's cold-start populate and reindex, and the dashboard reindex job — SHALL create it only through this first-index path, never by opening the target path in place. While another process's first index is live, the CLI's other commands SHALL print `(index is still being built — no results available yet; retry shortly)` and exit with status 75. Each install SHALL write one log line to standard error: `[kb] install=<link|rename|backup> retries=<n> ms=<n>` on success, `[kb] install-failed=<busy-timeout|backup-error:<errcode>> retries=<n> ms=<n>` on failure. Installing SHALL never overwrite an existing target path through the filesystem: the temp database SHALL be placed at the target path with an atomic create-if-absent operation, and when the target path already exists its contents SHALL be copied into the target through the SQLite online backup API, so connections other processes hold on the target observe the new contents and no stale write-ahead log is applied to them. When the atomic create-if-absent operation is unsupported by the filesystem, the target SHALL be re-checked and the temp file renamed onto it only if it is still absent (otherwise the backup install applies). A `<dbPath>.tmp-<pid>` file SHALL denote a live first index (the live-build marker) exactly when its PID names a live process and the newest modification time of the temp file or its write-ahead log lies between 0 and 120 seconds in the past; a live build SHALL refresh that modification time at least every 30 seconds, including within a batch. A run SHALL never remove a file it did not create: when a writer that does not honour the marker created the target during the build and the run then fails — the build throws, or the backup install cannot complete within its retry bound or fails otherwise — the run SHALL exit non-zero and leave the target as that writer's database.

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

### Requirement: Source walk honours gitignore with the excluded-parent rule
When gitignore respect is enabled (the default), the indexer SHALL omit every file ignored by the repository's `.gitignore` files (`.git/info/exclude` and `core.excludesFile` are not consulted; tracked-file override, character classes, backslash escapes and case-folding remain unimplemented), evaluating `.gitignore` files from the repository root (or project boundary) down to the file, and SHALL treat a file as ignored whenever any ancestor directory of it is ignored — including ancestors above the source directory. A pattern that does not match a directory on the file's ancestor chain SHALL be tested against the file path itself only; a negation that matches only directories (e.g. `!*/`) SHALL NOT re-include a file matched by an earlier pattern. A negation pattern SHALL NOT re-include a file or directory whose parent directory is ignored, and `.gitignore` files located inside an ignored directory SHALL NOT contribute patterns. Paths previously indexed that become ignored SHALL be removed by orphan removal on the next walk.

#### Scenario: Ignored directory containing nested .gitignore files is pruned
- **GIVEN** the repository root `.gitignore` contains the anchored pattern `packages/electron/out`
- **AND** `packages/electron/out/app/plugins/p/.gitignore` exists
- **WHEN** the source `packages` is walked
- **THEN** no file under `packages/electron/out/` is selected

#### Scenario: Nested negation cannot re-include under an ignored parent
- **GIVEN** the root `.gitignore` contains `vendored/`
- **AND** `vendored/.gitignore` contains `!keep.md`
- **WHEN** the source is walked
- **THEN** neither `vendored/keep.md` nor `vendored/other.md` is selected

#### Scenario: Source directory inside an ignored directory
- **GIVEN** the root `.gitignore` contains the anchored pattern `packages/electron/out`
- **WHEN** a source whose directory is `packages/electron/out/app` is walked
- **THEN** no file is selected

#### Scenario: Directory-only negation does not re-include files
- **GIVEN** the root `.gitignore` contains `*` followed by `!*/`
- **WHEN** the source is walked
- **THEN** `docs/x.md` is not selected

#### Scenario: Negation of the directory itself keeps it
- **GIVEN** the root `.gitignore` contains `skills/openspec-*/**` and `!skills/openspec-shared/**` and `!skills/openspec-shared/`
- **WHEN** the source is walked
- **THEN** files under `skills/openspec-shared/` are selected
- **AND** files under `skills/openspec-alpha/` are not selected

#### Scenario: Newly ignored files leave the index
- **GIVEN** files under an ignored directory were stored by an earlier walk
- **WHEN** the source is walked again with gitignore respect enabled
- **THEN** those files' chunks, synthetic meta chunk, nodes, edges, property rows and file state are deleted and counted as deletions

#### Scenario: Opt-out still indexes ignored files
- **WHEN** gitignore respect is disabled
- **THEN** files under ignored directories are selected subject only to the built-in exclusion set and caller filters

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

### Requirement: First index in a linked worktree seeds from the main checkout
When the atomic first-index path builds a docs database over its configured sources for a cwd inside a linked git worktree, and `seedFromMainWorktree` is not `false` and the run was started with neither `--no-seed` nor an explicit `--source`, it SHALL initialise its temporary database from a consistent snapshot of the main checkout's docs database instead of starting empty, and then run its normal walk and install. Linked-worktree detection and main-checkout resolution SHALL follow `git-checkout-root-resolution`; the seed SHALL be used only when the resolved main checkout exists, is a directory other than the worktree, belongs to the same repository, and holds a non-empty docs database at the worktree's database path relative to its checkout root.

Every pass SHALL maintain, per source, the kb engine fingerprint that produced all of that source's rows: a source whose recorded fingerprint is absent or differs from the running one SHALL be forced; a forced pass SHALL clear the record before changing any of the source's rows and SHALL record the running fingerprint when the source's walk completes. Before the walk, the seeded database SHALL keep a source's rows only when the worktree configures that source and the main checkout recorded, for it, the current schema version, the index-options hash of the worktree's configuration, and the running kb engine fingerprint; rows of every other source SHALL be removed, and every kept file SHALL be compared by content rather than by modification time. After the walk, the seeded rows of every source the caller did not pass or whose walk reported it missing SHALL be removed, and graph nodes left without an owning path and without referencing edges SHALL be swept, before the install.

When a snapshot was used, the worktree has no `dox-staleness.json`, and the main checkout's file exists, parses, and carries either no version (the legacy format) or exactly the supported version, that file SHALL be copied. The main checkout's database contents SHALL NOT be modified. Each first index SHALL write one line to standard error after the walk: `[kb] seed=<main checkout path> sources=<kept>/<passed>` when seeded rows were installed, or `[kb] seed-skipped=<disabled|not-a-worktree|no-main-checkout|custom-dbpath|main-building|no-main-index|snapshot-error>` otherwise, the first applicable reason in that order. A failure while seeding or while walking a seeded database SHALL abandon the seed and rerun the first index once without a seed in the same run; a failure while copying `dox-staleness.json` SHALL be logged and SHALL NOT fail the run.

#### Scenario: Seeded first index equals a first index
- **GIVEN** a main checkout with a current docs database and a linked worktree whose tree differs by edited, added and deleted markdown files, with no two sources sharing a relative path
- **WHEN** the worktree's first index runs
- **THEN** its files, chunks, properties, nodes and edges equal those of an unseeded first index of the worktree's tree
- **AND** only the differing files were re-chunked
- **AND** the log line is `[kb] seed=<main> sources=<n>/<n>`

#### Scenario: Files only in the main checkout do not reach the worktree
- **GIVEN** the main checkout's index contains an untracked file `notes/private.md` that the worktree does not have
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no rows for `notes/private.md`

#### Scenario: Same mtime, different content is re-chunked
- **GIVEN** a worktree file whose modification time equals the main checkout's recorded one but whose content differs
- **WHEN** the worktree's seeded first index runs
- **THEN** that file is re-chunked from the worktree's content

#### Scenario: Source with a mismatched record builds from scratch
- **GIVEN** the main checkout recorded an older index-options hash for source `docs` and current records for `packages`
- **WHEN** the worktree's first index runs
- **THEN** `packages` rows come from the seed and only its differing files are re-chunked
- **AND** every `docs` file is chunked as in an unseeded first index
- **AND** the log line reports `sources=1/2`

#### Scenario: Rows from another kb engine are not kept
- **GIVEN** the main checkout's rows for a source were produced by a kb engine fingerprint different from the running one, with no schema-version change
- **WHEN** the worktree's first index runs
- **THEN** that source's seeded rows are not kept and its files are chunked as in an unseeded first index

#### Scenario: Engine change forces a source once
- **GIVEN** a docs database whose source `docs` records engine fingerprint `A`
- **WHEN** a pass runs with engine fingerprint `B` and no file content changed
- **THEN** every `docs` file is re-chunked and the source records `B`

#### Scenario: Interrupted forced pass leaves no engine record
- **GIVEN** a forced pass of source `docs` that commits some batches and is then killed
- **WHEN** the database is inspected and a worktree later seeds from it
- **THEN** `docs` carries no engine record, its rows are not kept as a seed, and the next pass forces it

#### Scenario: Unconfigured source rows are dropped
- **GIVEN** the main checkout indexes a source `extra` that the worktree's configuration does not list
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no rows under `extra`

#### Scenario: Source not walked in the worktree is dropped
- **GIVEN** a configured source indexed in the main checkout that, in the worktree's run, is missing, or is not passed by the caller because it is untrusted or unresolvable
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no seeded rows and no graph nodes for that source's files

#### Scenario: No main checkout
- **WHEN** the first index runs in a main checkout or a directory outside git
- **THEN** no snapshot is taken and the log line is `[kb] seed-skipped=not-a-worktree`
- **AND** for a linked worktree for which `git-checkout-root-resolution` yields no main checkout (for example a worktree of a bare repository), the log line is `[kb] seed-skipped=no-main-checkout`

#### Scenario: Worktree of a submodule seeds from the submodule checkout
- **GIVEN** a linked worktree of a submodule whose submodule checkout holds a current docs database
- **WHEN** the worktree's first index runs
- **THEN** it seeds from the submodule checkout's database

#### Scenario: Seeding disabled
- **WHEN** `seedFromMainWorktree` is `false`, or `kb index` runs with `--no-seed` or an explicit `--source`
- **THEN** no snapshot is taken, no `dox-staleness.json` is copied, and the log line is `[kb] seed-skipped=disabled`

#### Scenario: Custom database path
- **WHEN** the configured database path lies outside the worktree, or the run passed `--db`
- **THEN** no snapshot is taken and the log line is `[kb] seed-skipped=custom-dbpath`

#### Scenario: Main checkout has no index or is building one
- **WHEN** the main checkout has no docs database or an empty file at its path, or has none and its own first index is live
- **THEN** the worktree builds an unseeded first index and logs `seed-skipped=no-main-index` or `seed-skipped=main-building` respectively

#### Scenario: Seed failure reruns unseeded
- **WHEN** taking the snapshot, applying acceptance, or walking the seeded database fails (for example the main database is not a database)
- **THEN** no seeded rows remain, the first index reruns once without a seed in the same run, and the log line is `[kb] seed-skipped=snapshot-error`

#### Scenario: Main checkout keeps working during the snapshot
- **GIVEN** a session in the main checkout is writing to its docs database in short transactions
- **WHEN** a worktree's first index takes its snapshot
- **THEN** the main checkout's writes succeed, its database contents are not modified by the worktree's run, and the snapshot contains a committed state of it, including commits still in its write-ahead log

#### Scenario: DOX acknowledgements copied once
- **GIVEN** a seeded first index, a main checkout `dox-staleness.json` with the supported version or no version, and no worktree file
- **WHEN** the worktree's first index installs
- **THEN** the worktree has an identical `dox-staleness.json`
- **AND** an existing worktree file, an absent or corrupt main file, a main file with an unsupported version, or an unwritable target leaves the worktree file unchanged and the run succeeds
