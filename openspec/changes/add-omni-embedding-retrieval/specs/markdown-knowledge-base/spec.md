## ADDED Requirements

### Requirement: Optional dense retrieval leg outside the indexer

The system SHALL permit an optional, config-gated, default-OFF dense retrieval leg whose vectors are produced by an explicit embed step separate from indexing. Indexing SHALL remain free of embedding-model calls. When the dense leg is disabled or unavailable, search SHALL run the lexical pipeline unchanged and SHALL NOT require any embedding dependency.

#### Scenario: Dense leg disabled
- **WHEN** no dense configuration is set
- **THEN** search SHALL NOT load an embedding model, open a vector store, or alter BM25 results

#### Scenario: Vectors persist behind their own interface
- **WHEN** the dense leg stores or queries vectors
- **THEN** it SHALL do so through a vector-store interface analogous to `KbStore`
- **AND** the parser, chunker, graph extractor, and lexical store SHALL remain unaware of vectors

#### Scenario: Indexing stays embedding-free
- **WHEN** `kb index` runs with the dense leg enabled
- **THEN** it SHALL NOT invoke any embedding model
