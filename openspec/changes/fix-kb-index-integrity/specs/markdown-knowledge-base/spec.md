## MODIFIED Requirements

### Requirement: Condensed default `kb_search` output with opt-in JSON

The `kb_search` native tool SHALL render results as a condensed, human/LLM-legible
text format by default, and SHALL accept a `format` parameter with values
`"condensed"` (default) and `"json"`. The `format` value SHALL be validated
against that allowlist; an unknown, malformed, or omitted value SHALL fall back
to `"condensed"` and SHALL NOT raise an error. The condensed format SHALL be
positional (no repeated field-name keys) and SHALL present a 1-based `rank`
ordinal in place of the raw BM25 score. The condensed format SHALL present the
**leaf heading** of a hit rather than its full heading-path breadcrumb, because
the breadcrumb is dominated by a prefix shared with sibling sections while the
leaf carries the discriminating text. The condensed format SHALL surface a
per-source suppressed-section count when source-level dedup has collapsed
further matching sections of that source. The `"json"` format SHALL return
compact (non-pretty-printed) JSON, SHALL retain the raw `score` field in
addition to `rank`, and SHALL retain the full `headingPath` so a caller can
address a section via `kb_get`. The condensed format SHALL surface the
`akaPaths` duplicate-count signal when present. The tool's own description SHALL
accurately describe the default output shape and SHALL state that `limit` bounds
distinct sources. The tool output format SHALL NOT be auto-parsed by any
consumer; `store.search()` remains the structured programmatic interface.

Any status line the tool prepends (for example an index-freshness notice, an
index-is-being-built notice, or a cancellation notice) SHALL precede the
entries, SHALL be a single line, and SHALL NOT alter the per-entry shape. In the
`"json"` format the hits SHALL remain a bare array with no wrapper object, and
any such status SHALL be emitted as a preceding line so the array is the final
line of the output, byte-identical to the array emitted without the status;
no consumer parses this output (per the rule above), and the status SHALL NOT be
carried only in the tool's structured details, which are a rendering channel
rather than a model-facing one.

#### Scenario: Condensed output by default

- **WHEN** `kb_search` is invoked without a `format` argument
- **THEN** the tool SHALL return condensed text: one entry per hit carrying
  `rank`, `path`, the hit's leaf heading, a `(+N dup)` marker when `akaPaths` is
  present, a suppressed-section marker when further sections of that source were
  collapsed, a parent-heading continuation when parent context exists, and a
  single-line bounded snippet
- **AND** the tool SHALL NOT emit the raw BM25 `score` in the condensed output
- **AND** the tool SHALL NOT emit the full heading-path breadcrumb in the
  condensed output

#### Scenario: Suppressed sections are reported per source

- **WHEN** source-level dedup has collapsed further matching sections of a
  returned source
- **THEN** that entry SHALL carry a marker naming how many further sections of
  that source matched
- **AND** an entry whose source matched exactly once SHALL carry no such marker

#### Scenario: One entry per source

- **WHEN** `kb_search` is invoked with `limit: N`
- **THEN** the condensed output SHALL contain at most `N` entries
- **AND** no two entries SHALL name the same `path`

#### Scenario: JSON output on request retains score and breadcrumb

- **WHEN** `kb_search` is invoked with `format: "json"`
- **THEN** the tool SHALL return compact JSON (no pretty-print indentation)
- **AND** each hit SHALL carry both `score` and `rank`
- **AND** each hit SHALL carry the full `headingPath`
- **AND** each hit SHALL carry the collapsed `parent` shape (`headingPath` only)
- **AND** each hit SHALL carry its suppressed-section count

#### Scenario: Unknown format falls back to condensed

- **WHEN** `kb_search` is invoked with a `format` value outside
  `{"condensed","json"}` (unknown string, wrong case, or null)
- **THEN** the tool SHALL render condensed output and SHALL NOT raise an error

#### Scenario: Empty query returns an explicit marker

- **WHEN** `kb_search` is invoked with an empty or whitespace-only `query`
- **THEN** the tool SHALL return an explicit empty indication (not an ambiguous
  blank string) consistently for the selected format

#### Scenario: Rank replaces raw score in condensed output

- **WHEN** the tool renders hits in condensed format
- **THEN** each entry SHALL carry a 1-based `rank` ordinal over the sorted results
- **AND** the negative unbounded BM25 `score` SHALL NOT appear in the condensed output

#### Scenario: Tool description matches the delivered shape

- **WHEN** the `kb_search` tool description is read
- **THEN** it SHALL describe the leaf-heading condensed shape, the
  suppressed-section marker, and that `limit` bounds distinct sources
- **AND** it SHALL NOT advise a query length that the ranking does not reward

#### Scenario: Building-index notice in json format

- **WHEN** `kb_search` is invoked with `format: "json"` while another process is building the
  cwd's first index
- **THEN** the output SHALL be the line
  `(index is still being built — no results available yet; retry shortly)` followed by `[]` as
  its final line

### Requirement: LLM-facing pull retrieval, not push injection

The knowledge base SHALL be exposed to LLM agents as a pull interface the agent
explicitly invokes (a SKILL-driven CLI in Phase 1, a registered native tool in
Phase 2). The system SHALL NOT auto-inject search results into the model context
via input or pre-tool hooks.

When the KB tools are registered for a cwd whose index has never been built,
each pull tool (`kb_search`, `kb_neighbors`, `kb_get`) SHALL self-populate the
index on first invocation before serving results, so an active-but-uninitialized
KB never returns a false-empty result. Self-population SHALL run only when the
index is empty (a warm index is not re-walked on the neighbors/get path), and a
failed population SHALL degrade to the existing store rather than error. While the
index does not exist and another process is building it (a live first-index marker), the
pull tools SHALL NOT self-populate and SHALL instead return the line
`(index is still being built — no results available yet; retry shortly)`. Self-population of a
not-yet-existing index SHALL build through the atomic first-index path (temporary file, then
install), so an interrupted self-population leaves no index behind.

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
- **THEN** the tool SHALL build the index once before serving results
- **AND** the invocation SHALL return the populated graph node / section rather
  than an empty result or "(not found)"

#### Scenario: Warm index is not re-walked on neighbors/get

- **WHEN** the index for a cwd is already populated and the agent invokes
  `kb_neighbors` or `kb_get`
- **THEN** the tool SHALL serve results without running a reindex walk
  (an empty-check `COUNT` only)

#### Scenario: Failed cold-start population degrades, not errors

- **WHEN** the first `kb_neighbors` / `kb_get` on an empty index triggers a build
  that throws
- **THEN** the tool SHALL fall back to the existing (empty) store and still
  return a well-formed result rather than propagating the error

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
