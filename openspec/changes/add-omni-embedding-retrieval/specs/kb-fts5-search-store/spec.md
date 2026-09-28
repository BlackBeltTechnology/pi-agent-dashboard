## ADDED Requirements

### Requirement: Optional dense-candidate fusion

The search store SHALL accept an optional list of precomputed dense candidates (source root, chunk id, dense rank) with a search call. When present, it SHALL drop candidates whose chunk no longer exists, fuse the remainder with its lexical candidate pool by reciprocal-rank fusion, and apply all of its existing page steps to the fused list. When absent or empty, search results SHALL be identical to the lexical-only path. The store SHALL NOT compute embeddings or contact any embedding service.

#### Scenario: No dense candidates
- **WHEN** search is called without dense candidates
- **THEN** results SHALL be identical to the current lexical search for the same query and options

#### Scenario: Dense-only candidate enters page
- **WHEN** a dense candidate has no lexical match but ranks first in the dense list
- **THEN** it SHALL be eligible for the returned page and SHALL carry the same fields as a lexical hit

#### Scenario: Unknown chunk id
- **WHEN** a dense candidate references a chunk id absent from the index
- **THEN** the candidate SHALL be ignored without error
