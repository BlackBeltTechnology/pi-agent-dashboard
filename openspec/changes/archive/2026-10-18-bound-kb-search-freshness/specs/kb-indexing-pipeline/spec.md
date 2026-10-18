## MODIFIED Requirements

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
