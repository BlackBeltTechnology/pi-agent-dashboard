## MODIFIED Requirements

### Requirement: LLM-facing pull retrieval, not push injection

The knowledge base SHALL be exposed to LLM agents as a pull interface the agent
explicitly invokes (a SKILL-driven CLI in Phase 1, a registered native tool in
Phase 2). The system SHALL NOT auto-inject search results into the model context
via input or pre-tool hooks.

When the KB tools are registered for a cwd whose index has never been built,
each pull tool (`kb_search`, `kb_neighbors`, `kb_get`) SHALL self-populate the
index on first invocation before serving results, so an active-but-uninitialized
KB never returns a false-empty result. Self-population SHALL be started only when the
index is empty (a warm index with no indexing pass in flight is not re-walked on
the neighbors/get path; a call arriving while a pass is in flight joins that pass
under the freshness budget instead of starting one), and a
failed population SHALL degrade to the existing store rather than error. While the
index does not exist and another process is building it (a live first-index marker), the
pull tools SHALL NOT self-populate and SHALL return the index-is-being-built
indication. Self-population of a not-yet-existing index SHALL build through the atomic
first-index path (temporary file, then install), so an interrupted self-population
leaves no index behind.

Self-population SHALL be bounded by the freshness budget, and a bounded return
SHALL distinguish two cases in the tool's model-facing output. When the index
still holds no chunks for that cwd at the moment of answering and no indexing
pass for that cwd has yet completed, the tool SHALL
return an explicit index-is-being-built indication instead of a hit list, an
empty node list or a not-found marker, so an answer that is empty only because
indexing has not produced anything yet is never shaped like a complete result.
A pass that completed without producing chunks, or that failed, SHALL NOT
produce the index-is-being-built indication.
When the index holds chunks but the pass has not finished, the tool SHALL serve
those results and SHALL report that the answer may be stale. Both indications
SHALL appear in the model-facing output rather than only in the tool's
structured details. Population SHALL continue running after either return, so a
later invocation is served from the completed index. These rules SHALL hold for
`kb_search`, `kb_neighbors` and `kb_get` alike.

#### Scenario: Agent retrieves on demand via SKILL

- **WHEN** the `kb-search` SKILL is active and the agent encounters an unknown
  term or decision
- **THEN** the agent SHALL invoke the `kb` search interface to retrieve ranked
  sections before answering from memory or asking the user

#### Scenario: No push auto-injection

- **WHEN** a user message or tool call occurs
- **THEN** the system SHALL NOT automatically run a search and inject its results
  into the model context

#### Scenario: Cold KB self-populates on first neighbors/get

- **WHEN** the KB tools are active for a cwd whose index has never been built
  (`store.counts().chunks === 0`) and the agent invokes `kb_neighbors` or
  `kb_get`
- **THEN** the tool SHALL start building the index once and wait for it up to
  the freshness budget before serving results
- **AND** when population completes within the budget, the invocation SHALL
  return the populated graph node / section rather than an empty result or
  "(not found)"
- **AND** when it does not, the invocation SHALL return the index-is-being-built
  indication described below, never a bare empty result or "(not found)"

#### Scenario: Warm index is not re-walked on neighbors/get

- **WHEN** the index for a cwd is already populated, no indexing pass for that
  cwd is in flight, and the agent invokes `kb_neighbors` or `kb_get`
- **THEN** the tool SHALL serve results without running a reindex walk
  (an empty-check `COUNT` only)

#### Scenario: Warm index with a pass in flight joins it

- **WHEN** the index for a cwd is already populated, an indexing pass for that
  cwd is in flight, and the agent invokes `kb_neighbors` or `kb_get`
- **THEN** the tool SHALL wait on that pass for at most the freshness budget and
  SHALL NOT start a second walk
- **AND** if the budget elapses first, the answer SHALL carry the staleness report

#### Scenario: Failed cold-start population degrades, not errors

- **WHEN** the first `kb_neighbors` / `kb_get` on an empty index triggers a build
  that throws
- **THEN** the tool SHALL fall back to the existing (empty) store and still
  return a well-formed result rather than propagating the error

#### Scenario: Cold-start population slower than the budget is reported, not hidden

- **WHEN** population of a never-built index has not completed within the
  freshness budget, the index still holds no chunks, and no pass for that cwd
  has completed
- **THEN** the tool SHALL return an explicit index-is-being-built indication in
  its model-facing output instead of a hit list, an empty node list or a
  not-found marker
- **AND** population SHALL continue so a later invocation serves the completed
  index

#### Scenario: Partially built index serves results with a staleness report

- **WHEN** a pull tool answers while a population or freshness pass is still
  running and the index already holds chunks
- **THEN** the tool SHALL serve from the index as it stands and SHALL report in
  its model-facing output that the answer may be stale
- **AND** the report SHALL be present for `kb_neighbors` and `kb_get` as well as
  `kb_search`

#### Scenario: A never-waiting budget still reports the cold case

- **WHEN** the freshness budget is configured so the tool never waits, the
  index holds no chunks for that cwd, and no pass for that cwd has completed
- **THEN** the tool SHALL return the index-is-being-built indication rather than
  an empty result

#### Scenario: A completed pass with no indexable content is a normal empty result

- **WHEN** an indexing pass for a cwd has completed and produced no chunks (for
  example a missing source directory or no indexable files)
- **THEN** later pull-tool calls SHALL return their normal empty result without
  the index-is-being-built indication

#### Scenario: Pull tools defer to another process's first index

- **WHEN** the index for a cwd does not exist and another live process is building it, and the
  agent invokes `kb_search`, `kb_neighbors` or `kb_get`
- **THEN** the tool SHALL NOT build or create the index
- **AND** SHALL return `(index is still being built — no results available yet; retry shortly)`
  rather than an empty result or "(not found)"

### Requirement: Tier-1 deterministic knowledge graph

The indexer SHALL populate `nodes` and `edges` tables during the same parse
pass, deriving edges deterministically from heading nesting (`child_of`),
`[[wikilinks]]` (`links_to`), markdown links (`references`), and YAML
frontmatter (typed entities and `has_tag`). The system SHALL expose graph
traversal via recursive CTEs. No LLM-based extraction SHALL be performed.
Heading nodes SHALL be distinct per file. Incremental reindexing SHALL NOT lose
or rewrite graph rows owned by unchanged files: after any sequence of incremental
passes the graph SHALL equal the graph a first index of the same tree produces (for trees in
which no two sources contain the same relative path),
where equality compares nodes by `(type, name, path)` and edges by
`(source name, target name, relation)`, not by internal ids.

#### Scenario: Heading nesting produces child_of edges

- **WHEN** a file with nested headings is indexed
- **THEN** each subsection node SHALL have a `child_of` edge to its parent
  section or file node

#### Scenario: Neighbor traversal

- **WHEN** a caller runs `kb neighbors "<heading_path>" --depth 2`
- **THEN** the system SHALL return nodes reachable within 2 hops via recursive
  CTE traversal
- **AND** a bare heading path matching headings in several files SHALL traverse from every matching heading, while a file-qualified `<file>#<heading_path>` SHALL traverse from that file's heading only

#### Scenario: Backlinks

- **WHEN** a caller runs `kb backlinks "<file>"`
- **THEN** the system SHALL return nodes whose edges point at that file (inbound)

#### Scenario: Backlinks survive an edit of the target

- **GIVEN** `a.md` links to `b.md` and both are indexed
- **WHEN** `b.md` is edited and an incremental reindex runs
- **THEN** `kb backlinks "b.md"` SHALL still return `a.md`

#### Scenario: Incremental graph equals first-index graph

- **GIVEN** an indexed tree in which no two sources contain the same relative path
- **WHEN** a sequence of edits, additions and deletions is applied with an incremental reindex after each
- **THEN** the stored nodes and edges SHALL equal those of a first index of the final tree

#### Scenario: No LLM extraction

- **WHEN** the indexer builds the graph
- **THEN** it SHALL NOT call any LLM or embedding model to derive entities or
  relations

### Requirement: kb index is atomic on failure

A `kb index` run SHALL NOT leave a committed database file at `dbPath` when the run fails
before completing successfully. A file present at `dbPath` after a successful `kb index`
SHALL hold that run's complete result, and a file at `dbPath` SHALL mean that some first index
completed successfully — every writer that creates the docs database creates it only through the
atomic first-index path — except as stated below.

The store is opened with `CREATE TABLE IF NOT EXISTS`, so merely opening it writes an empty
schema to disk. A run that had to create the database (no prior `dbPath`) SHALL build into a
temporary path (`<dbPath>.tmp-<pid>`) and install it onto `dbPath` only after the index
resolves — so a crash, OOM, or SIGKILL leaves only the temporary orphan and never a committed
`dbPath`. A create-then-`close()`+unlink()-on-failure variant SHALL NOT be used: its cleanup
does not run under uncatchable termination (OOM/SIGKILL), which would leave exactly the husk
this requirement eliminates. On a clean finalize the WAL SHALL be checkpointed and the temp
store closed before installing. Installing SHALL place the temp file at `dbPath` with an atomic
create-if-absent operation; when `dbPath` already exists (another process created it during the
build), installing SHALL copy the result into `dbPath` through the SQLite online backup API,
because replacing a database another process holds open lets that process's write-ahead log
overwrite the installed result. Exception: a run never removes a file it did not create, so when a
writer that does not honour the live-build marker created `dbPath` during the build and the run
then fails (the build throws, or the backup cannot complete within its bounded retry), the run
SHALL exit non-zero and `dbPath` SHALL remain that writer's database.

A run over an already-valid database SHALL index in place and leave that database valid and
queryable on failure (it may be partially updated by committed batches) — only a run that
itself created the file is responsible for removing it. A stale `<dbPath>.tmp-*` orphan from a
prior killed run SHALL be swept on the next index startup.

#### Scenario: Failed index leaves no artifact

- **WHEN** `kb index` is run and the index step throws before completion (missing source,
  interrupt, or error) on a checkout with no prior `dbPath`
- **THEN** the process SHALL exit non-zero
- **AND** there SHALL be no file at `dbPath` (no empty-schema husk)

#### Scenario: Failed incremental run preserves a valid prior index

- **WHEN** a valid populated index exists at `dbPath` and a subsequent `kb index` run fails
- **THEN** the prior index at `dbPath` SHALL remain valid and queryable (possibly partially
  updated by committed batches; a re-run completes it)

#### Scenario: Successful index commits the file

- **WHEN** `kb index` completes successfully over at least one non-empty source
- **THEN** a single SQLite file SHALL be present at `dbPath` with a non-zero chunk count

#### Scenario: Concurrent opener does not erase a successful first index

- **GIVEN** no `dbPath` exists and `kb index` starts a first index
- **WHEN** a writer that does not honour the live-build marker opens and writes `dbPath` while the build runs, and keeps it open
- **THEN** after `kb index` reports success, `dbPath` SHALL hold the reported file and chunk counts
- **AND** it SHALL keep them after that writer closes its connection
