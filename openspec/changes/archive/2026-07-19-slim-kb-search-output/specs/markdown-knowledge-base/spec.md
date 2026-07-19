# markdown-knowledge-base — delta

## ADDED Requirements

### Requirement: Condensed default `kb_search` output with opt-in JSON

The `kb_search` native tool SHALL render results as a condensed, human/LLM-legible
text format by default, and SHALL accept a `format` parameter with values
`"condensed"` (default) and `"json"`. The `format` value SHALL be validated
against that allowlist; an unknown, malformed, or omitted value SHALL fall back
to `"condensed"` and SHALL NOT raise an error. The condensed format SHALL be
positional (no repeated field-name keys) and SHALL present a 1-based `rank`
ordinal in place of the raw BM25 score. The `"json"` format SHALL return compact
(non-pretty-printed) JSON and SHALL retain the raw `score` field in addition to
`rank`. The condensed format SHALL surface the `akaPaths` duplicate-count signal
when present. The tool's own description SHALL accurately describe the default
output shape. The tool output format SHALL NOT be auto-parsed by any consumer;
`store.search()` remains the structured programmatic interface.

#### Scenario: Condensed output by default

- **WHEN** `kb_search` is invoked without a `format` argument
- **THEN** the tool SHALL return condensed text: one entry per hit carrying
  `rank`, `path`, `headingPath`, a `(+N dup)` marker when `akaPaths` is present,
  a parent-heading continuation when parent context exists, and a single-line
  bounded snippet
- **AND** the tool SHALL NOT emit the raw BM25 `score` in the condensed output

#### Scenario: JSON output on request retains score

- **WHEN** `kb_search` is invoked with `format: "json"`
- **THEN** the tool SHALL return compact JSON (no pretty-print indentation)
- **AND** each hit SHALL carry both `score` and `rank`
- **AND** each hit SHALL carry the collapsed `parent` shape (`headingPath` only)

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

## MODIFIED Requirements

### Requirement: Parent and graph context expansion

Search SHALL support returning a child hit together with its parent
section/file (small-to-big), using the stored `parent_chunk_id` and `child_of`
edges, and SHALL optionally expand results with graph neighbors/backlinks.
Parent expansion SHALL be on by default; graph expansion SHALL be opt-in.
The attached parent SHALL carry only `headingPath`, as display/context — NOT a
refetch key — and SHALL NOT include `root`, `path`, `docType`, `chunkId`, a
constant `score`, or a `snippet`. The parent chunk is, by construction of the
indexer's per-file heading stack, in the same file as the child, so the omitted
location fields are redundant. `KbHit.parent` is consequently non-recursive.

#### Scenario: Parent context returned with a section hit

- **WHEN** `kb search --expand-parent` (or default) returns a subsection hit
- **THEN** the result SHALL include the parent section/file context
- **AND** the parent SHALL expose `headingPath` only

#### Scenario: Parent carries no fields duplicated from the child

- **WHEN** parent expansion attaches a parent to a hit
- **THEN** the parent object SHALL NOT include `root`, `path`, `docType`,
  `chunkId`, a constant `score`, or a `snippet` field
