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
