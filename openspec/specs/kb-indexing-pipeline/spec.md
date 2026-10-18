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
- **THEN** the file's existing chunks and graph nodes are deleted and it is re-chunked and re-inserted
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
deleting their chunks, owned graph nodes, dangling edges, property rows, synthetic
meta chunk, and file state.

#### Scenario: Deleted file pruned
- **WHEN** a path recorded in the store for a source is not present on disk during
  the walk
- **THEN** that path's chunks (including its synthetic meta chunk), nodes, edges,
  property rows, and file-state row are deleted and the deletion is counted

#### Scenario: Reindex does not duplicate property rows
- **WHEN** a changed file is re-indexed
- **THEN** its prior property rows and synthetic meta chunk are removed before the
  new ones are written, so no duplicate property rows accumulate

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
