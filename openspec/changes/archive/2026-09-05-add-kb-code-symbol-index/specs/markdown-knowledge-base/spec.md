# markdown-knowledge-base — delta

## MODIFIED Requirements

### Requirement: Tier-1 deterministic knowledge graph

The indexer SHALL populate `nodes` and `edges` tables during the same parse
pass, deriving edges deterministically from heading nesting (`child_of`),
`[[wikilinks]]` (`links_to`), markdown links (`references`), and frontmatter
(typed entities and `has_tag`). Additionally, an opt-in code-symbol extractor
MAY populate `nodes` with `type='symbol'` and `edges` with `defined_in` and
candidate `references` relations derived deterministically from a tree-sitter
parse. The system SHALL expose graph traversal via recursive CTEs. No LLM-based
extraction SHALL be performed in either path.

#### Scenario: Heading nesting produces child_of edges

- **WHEN** the indexer parses nested markdown headings
- **THEN** it SHALL emit `child_of` edges between the heading nodes

#### Scenario: Code symbols extend the same graph without an LLM

- **WHEN** symbol extraction is enabled and the indexer runs
- **THEN** it SHALL emit `symbol` nodes and `defined_in`/`references` edges
- **AND** it SHALL NOT invoke any LLM in doing so

#### Scenario: No LLM extraction

- **WHEN** the indexer builds the graph
- **THEN** it SHALL NOT invoke any LLM or embedding model
