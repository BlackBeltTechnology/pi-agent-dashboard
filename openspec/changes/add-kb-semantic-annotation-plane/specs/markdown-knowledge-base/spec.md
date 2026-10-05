# markdown-knowledge-base — delta

## MODIFIED Requirements

### Requirement: Tier-1 deterministic knowledge graph

The indexer SHALL populate `nodes` and `edges` tables during the same parse
pass, deriving edges deterministically from heading nesting (`child_of`),
`[[wikilinks]]` (`links_to`), markdown links (`references`), and YAML
frontmatter. Frontmatter-derived nodes/edges SHALL include `has_tag` (from
`tags`) AND typed `entity` nodes and typed relation edges declared in a
machine-managed `kb:` frontmatter block, emitted **only** for items marked
`status: approved`. Typed relation edges SHALL carry a CURIE predicate as their
`rel`. The system SHALL expose graph traversal via recursive CTEs. The indexer
SHALL NOT call any LLM or embedding model to derive entities or relations; any
LLM-based enrichment SHALL occur out-of-band in the separate annotation plane
(capability `kb-semantic-annotation`) whose sole output is frontmatter the
indexer then reads deterministically.

#### Scenario: Heading nesting produces child_of edges

- **WHEN** a file with nested headings is indexed
- **THEN** each subsection node SHALL have a `child_of` edge to its parent
  section or file node

#### Scenario: Neighbor traversal

- **WHEN** a caller runs `kb neighbors "<heading_path>" --depth 2`
- **THEN** the system SHALL return nodes reachable within 2 hops via recursive
  CTE traversal

#### Scenario: Backlinks

- **WHEN** a caller runs `kb backlinks "<file>"`
- **THEN** the system SHALL return nodes whose edges point at that file (inbound)

#### Scenario: Typed entity nodes and edges from approved frontmatter

- **WHEN** a file carries a `kb:` block with an entity or relation marked
  `status: approved`
- **THEN** the indexer SHALL emit a corresponding `entity` node and/or typed edge
  (with a CURIE predicate `rel`) deterministically
- **AND** items marked `status: proposed` or `status: rejected` SHALL produce no
  graph edges

#### Scenario: No LLM extraction in the indexer

- **WHEN** the indexer builds the graph
- **THEN** it SHALL NOT call any LLM or embedding model to derive entities or
  relations
- **AND** any LLM enrichment SHALL have already run out-of-band, leaving only
  frontmatter for the indexer to read

#### Scenario: No LLM extraction

- **WHEN** the indexer builds the graph
- **THEN** it SHALL NOT call any LLM or embedding model to derive entities or
  relations
