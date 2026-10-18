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
failed population SHALL degrade to the existing store rather than error.

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

#### Scenario: Freshness notice precedes condensed entries

- **WHEN** condensed output is rendered for a search whose index refresh did not
  complete
- **THEN** a single status line SHALL precede the entries
- **AND** each entry SHALL keep the shape it has without the notice

#### Scenario: JSON output stays a bare array

- **WHEN** `format: "json"` is rendered for a search whose index refresh did not
  complete
- **THEN** the hits SHALL remain an array with no wrapper object, emitted as the
  final line of the output
- **AND** the staleness indication SHALL appear as a line preceding that array
- **AND** that final line SHALL be byte-identical to the array emitted for the
  same hits without the staleness indication

#### Scenario: Cancelled search emits the marker and an empty array in JSON

- **WHEN** `format: "json"` is rendered for a search that was cancelled
- **THEN** the output SHALL be the cancellation line followed by an empty array
  as its final line
