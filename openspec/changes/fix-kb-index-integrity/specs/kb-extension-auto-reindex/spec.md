## MODIFIED Requirements

### Requirement: Debounced hash-gated reindex on markdown edit

Job 1 SHALL run whenever a `write`, `edit`, or `bash` tool result carries a path ending in `.md`, `.mdx`, `.markdown`, `.adoc`, or `.asciidoc`, scheduling a debounced incremental reindex whose actual re-chunking is gated by file content changes. Reindex eligibility and DOX-nudge eligibility SHALL be decided by independent predicates: scheduling a reindex for an AsciiDoc edit MUST NOT exempt that edit from Job 2's nudge decision. Every reindex pass SHALL index with the full option set derived from the resolved configuration (including the frontmatter facet configuration) and SHALL apply the store's per-source schema-version / options-hash gate, exactly as the `kb index` CLI does. A failure while indexing one source SHALL NOT prevent the pass from indexing the remaining sources.

#### Scenario: Markdown edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.md`/`.mdx`/`.markdown` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd
- **AND** the reindex fires after the debounce window (default 800 ms) elapses with no further edit

#### Scenario: AsciiDoc edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.adoc`/`.asciidoc` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd, identically to a markdown edit

#### Scenario: AsciiDoc edit stays nudge-eligible
- **WHEN** DOX enforcement is on and a `.adoc` file lacking a fresh AGENTS.md row is edited
- **THEN** a reindex is scheduled AND the DOX nudge for that path is still evaluated and sent

#### Scenario: Rapid successive edits collapse to one reindex
- **WHEN** multiple markdown edits arrive for the same cwd within the debounce window
- **THEN** each new edit clears the pending timer and reschedules
- **AND** only a single reindex runs after the last edit, keyed per cwd

#### Scenario: Unchanged content skips re-chunking
- **WHEN** the debounced reindex walks the sources
- **THEN** the incremental indexer compares each file's mtime then sha256 hash
- **AND** files whose hash is unchanged are not re-chunked

#### Scenario: A bash tool result with no path is ignored
- **WHEN** a `bash` tool result carries a `command` but no `path`
- **THEN** no reindex is scheduled (bash commands are not parsed for edits)

#### Scenario: Reindex failure is swallowed
- **WHEN** the debounced reindex rejects
- **THEN** the error is logged as a warning and does not crash the session

#### Scenario: Reindex converges a stale schema stamp
- **GIVEN** the cwd's docs database carries no current per-source record
- **WHEN** a debounced reindex runs and every source walks successfully
- **THEN** it force-reindexes those sources and records the current schema version and options hash for each

#### Scenario: One failing source does not stop the others
- **GIVEN** a cwd with two filesystem sources
- **WHEN** a reindex pass throws while indexing the first source
- **THEN** the second source is still indexed and recorded
- **AND** the first source keeps its previous record, so the next pass forces it again

#### Scenario: Reindex honours custom frontmatter facets
- **GIVEN** a configuration declaring a custom facet key
- **WHEN** a debounced reindex re-chunks a file carrying that key
- **THEN** the file's property rows include the custom facet value

### Requirement: Cold-start populate and freshness reindex on pull tools

The pull tools SHALL ensure the index reflects on-disk content before returning results, populating an empty index and refreshing a warm one, while never letting an indexing failure break retrieval. Calls that target the `git` scope SHALL NOT trigger the docs freshness reindex or cold-start populate; the `git` scope keeps its own freshness. While the cwd's docs database does not exist and a first index by another process is live (a `<dbPath>.tmp-<pid>` whose PID names a live process), the pull tools and the debounced reindex SHALL NOT create, open-for-write or populate the docs database; the pull tools SHALL instead return a result whose model-facing text is the single line `(index is still being built — no results available yet; retry shortly)`. When `kb_search` is called with `format: "json"`, that line SHALL be followed by `[]` as the final line. The back-off SHALL be decided before any store is constructed for that cwd, and the debounced reindex SHALL skip without logging a warning. Populating a docs database that does not exist yet SHALL build through the atomic first-index path. When the index already holds chunks and the pass would be forced by the store's schema-version / options-hash gate, `kb_search` SHALL start that pass (or find that gate-forced pass in flight) without awaiting it and answer from the existing index, and a failure of that unawaited pass SHALL be logged as a warning and SHALL NOT surface; a non-forced pass in flight SHALL still be awaited; `kb_get` and `kb_neighbors` on a warm index start no pass; a cold-start populate of an empty index SHALL still be awaited.

#### Scenario: kb_search reindexes before searching
- **WHEN** `kb_search` executes with a non-empty query and without `scope: "git"`
- **THEN** a freshness reindex is awaited before the FTS query runs, except a pass the schema-version / options-hash gate forces over an index that already holds chunks, which is started (or found in flight) and not awaited
- **AND** an empty or whitespace query returns an empty result without indexing

#### Scenario: kb_neighbors and kb_get populate a cold index
- **WHEN** `kb_neighbors`, or `kb_get` without `scope: "git"`, runs against a never-indexed cwd
- **THEN** the index is populated once (guarded by a chunk-count check) before the graph walk or chunk fetch
- **AND** a warm index performs only a count check and no walk

#### Scenario: Git-scope calls skip the docs reindex
- **WHEN** `kb_search` or `kb_get` runs with `scope: "git"`
- **THEN** no docs freshness reindex or cold-start populate runs

#### Scenario: Indexing failure falls back to the existing index
- **WHEN** the freshness reindex or cold-start populate throws
- **THEN** the failure is logged as a warning and the tool answers from the existing index

#### Scenario: Concurrent reindexes coalesce
- **WHEN** a debounce-triggered reindex and a pull-tool freshness reindex overlap for the same cwd
- **THEN** both share a single in-flight walk rather than interleaving transactions on the shared store

#### Scenario: Pull tool backs off during another process's first index
- **GIVEN** the cwd has no docs database and another live process is building `<dbPath>.tmp-<pid>`
- **WHEN** `kb_search`, `kb_get` or `kb_neighbors` runs without `scope: "git"`
- **THEN** no file is created at `dbPath` and no walk runs
- **AND** the tool returns, without raising an error, the model-facing line `(index is still being built — no results available yet; retry shortly)`

#### Scenario: Debounced reindex backs off during another process's first index
- **GIVEN** the cwd has no docs database and another live process is building `<dbPath>.tmp-<pid>`
- **WHEN** a debounced reindex fires
- **THEN** no file is created at `dbPath` and the pass is skipped without error or warning

#### Scenario: Gate-forced pass does not stall a pull tool
- **GIVEN** a populated docs database whose sources carry no current schema-version / options-hash record
- **WHEN** `kb_search` runs
- **THEN** it returns results from the existing index without waiting for the forced pass
- **AND** a second `kb_search` while that pass is in flight also returns without waiting for it
- **AND** the forced pass runs to completion in the background and records the current values

#### Scenario: Unawaited forced pass failure is swallowed
- **WHEN** a gate-forced pass started without awaiting throws
- **THEN** the failure is logged as a warning, the session keeps running, and later pull tools answer from the existing index

#### Scenario: Debounced pass in flight is still awaited
- **GIVEN** a debounced, non-forced reindex is in flight after a markdown edit
- **WHEN** `kb_search` runs
- **THEN** it awaits that pass before searching, so the edit is searchable

#### Scenario: Dead build marker does not block
- **GIVEN** the cwd has no docs database and a `<dbPath>.tmp-<pid>` whose PID names no live process
- **WHEN** a pull tool runs
- **THEN** the cold-start populate proceeds as for a never-indexed cwd
