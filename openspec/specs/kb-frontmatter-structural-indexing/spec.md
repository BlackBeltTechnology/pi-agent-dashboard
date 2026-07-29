# kb-frontmatter-structural-indexing Specification

## Purpose
TBD - created by archiving change add-kb-frontmatter-structural-indexing. Update Purpose after archive.
## Requirements
### Requirement: Role-based frontmatter routing
The system SHALL route each parsed frontmatter key to one of three roles —
searchable text, facet/filter, or sort/range — driven by configuration, and SHALL
be fully deterministic (no LLM). The same file bytes and same configuration MUST
produce identical indexed structures across runs.

#### Scenario: Searchable keys become full-text searchable
- **WHEN** a file's frontmatter contains a configured searchable key (default
  `title`, `description`, `aliases`, `keywords`)
- **THEN** those values are indexed as full-text so a query matching them returns
  that file, ranked
- **AND** `tags` is NOT included in the searchable text (it is a facet)

#### Scenario: Facet keys become filterable with counts
- **WHEN** a file's frontmatter contains a configured facet key (e.g. `status`,
  `docType`, `author`, `tags`, `date`)
- **THEN** a structured property is recorded that supports exact-match, `IN`, and
  count aggregation over that key/value

#### Scenario: Determinism
- **WHEN** the same file and configuration are indexed twice
- **THEN** the resulting searchable text, property rows, and graph are byte-for-byte
  identical

### Requirement: Searchable metadata via a synthetic meta chunk
The indexer SHALL represent a file's searchable frontmatter as one synthetic chunk
inserted into the existing chunk store, so that a metadata hit is shape-identical
to a normal chunk hit and flows through the existing ranking, dedup, and expansion
pipeline unchanged.

#### Scenario: Synthetic meta chunk emitted
- **WHEN** a file has at least one configured searchable frontmatter value
- **THEN** one synthetic chunk is inserted with a stable id derived from the file
  (a `:meta` suffix), the `title` placed in the heading/heading-path fields, and
  the remaining searchable values placed in the body field

#### Scenario: Title match surfaces the file
- **WHEN** a query matches a file's `title`
- **THEN** the file is returned as a hit whose heading path is the title, ranked
  with at least the heading field weight

#### Scenario: No searchable frontmatter, no synthetic chunk
- **WHEN** a file has none of the configured searchable keys
- **THEN** no synthetic meta chunk is emitted for it

### Requirement: Structured properties store
The store SHALL persist frontmatter facet values in a properties table keyed by
`(root, path, key)` with a normalized `value`, an optional numeric `value_num`, an
optional ISO-date `value_date`, and a raw `value_raw` for display. Array values
SHALL produce one row per distinct element; duplicate elements within a single
file SHALL be de-duplicated so a `(path, key, value)` triple is stored at most
once (a facet count therefore reflects distinct files, not occurrences).

#### Scenario: Normalized value used for matching
- **WHEN** a facet value is stored
- **THEN** `value` is lowercased and trimmed and is what exact/`IN` filters and
  facet counts match against
- **AND** `value_raw` preserves the original for display

#### Scenario: Declared typing
- **WHEN** a facet key is declared numeric or date in configuration and its value
  fully matches the strict numeric or `YYYY-MM-DD` pattern
- **THEN** `value_num` or `value_date` is populated for range/sort use
- **AND** any key not so declared, or a value not matching the strict pattern,
  remains a string with `value_num`/`value_date` null

#### Scenario: Array element per row, de-duplicated within a file
- **WHEN** a facet value is an array
- **THEN** one property row is written per distinct element
- **AND** a value repeated within the same file's array yields exactly one row for
  that `(path, key, value)` triple

### Requirement: Filtered and faceted query surface
The search API SHALL accept optional structured filters (exact, `IN`, and range)
evaluated against the properties store alongside full-text matching, and SHALL
expose a facet-count call. All caller/config-supplied filter values MUST be bound
as SQL parameters, never string-interpolated. Omitting filters MUST leave existing
search behavior and output byte-for-byte unchanged.

#### Scenario: Exact and IN filters
- **WHEN** a caller passes an `eq` or `in` filter on a facet key
- **THEN** only files whose normalized property `value` matches are returned,
  intersected with the full-text results

#### Scenario: Range filter on a typed key
- **WHEN** a caller passes a `gte`/`lte` filter on a key declared numeric or date
- **THEN** only files whose `value_num`/`value_date` satisfies the bound are
  returned

#### Scenario: Facet counts reflect distinct files
- **WHEN** a caller requests facets for configured keys
- **THEN** a map of `value → count` is returned per key, where each count is the
  number of distinct files carrying that value over the current filtered result
  set (within-file duplicates never inflate the count)

#### Scenario: Filter values are parameter-bound
- **WHEN** a filter value contains SQL metacharacters
- **THEN** it is treated as a literal via a bound parameter and cannot alter the
  query

#### Scenario: No filters is a no-op
- **WHEN** no filters and no facet request are supplied
- **THEN** the query plan, ranking, and returned hits are identical to today's
  behavior

### Requirement: Machine namespace exclusion
The structural pipeline SHALL recognize a top-level `kb:` frontmatter key,
consume and discard its entire subtree, and never emit searchable text, property
rows, or graph edges from it. The `kb:` namespace is owned by the semantic
annotation plane.

#### Scenario: kb block ignored
- **WHEN** a file's frontmatter contains a top-level `kb:` block
- **THEN** no synthetic meta chunk content, property row, or edge is derived from
  anything under `kb:`
- **AND** parsing the rest of the frontmatter is unaffected

