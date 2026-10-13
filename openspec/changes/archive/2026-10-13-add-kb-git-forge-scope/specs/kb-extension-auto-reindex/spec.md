## MODIFIED Requirements

### Requirement: Cold-start populate and freshness reindex on pull tools

The pull tools SHALL ensure the index reflects on-disk content before returning results, populating an empty index and refreshing a warm one, while never letting an indexing failure break retrieval. Calls that target the `git` scope SHALL NOT trigger the docs freshness reindex or cold-start populate; the `git` scope keeps its own freshness.

#### Scenario: kb_search reindexes before searching
- **WHEN** `kb_search` executes with a non-empty query and without `scope: "git"`
- **THEN** a freshness reindex is awaited before the FTS query runs
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
