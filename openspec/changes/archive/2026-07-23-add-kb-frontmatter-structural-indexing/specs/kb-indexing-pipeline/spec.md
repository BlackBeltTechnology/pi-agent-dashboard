## MODIFIED Requirements

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
