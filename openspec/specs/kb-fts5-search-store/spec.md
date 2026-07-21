# kb-fts5-search-store Specification

## Purpose
The FTS5 search store provides full-text search over indexed markdown chunks using BM25 field-weighted ranking, with optional query expansion, dedup, lexical diversity, proximity boost, parent-context expansion, and a pluggable rerank hook. Matching is stem-based via the FTS5 `porter unicode61` tokenizer, and match/proximity terms exclude a fixed stopword set. It also answers graph queries (neighbors, backlinks) over the node/edge relations built during indexing.

## Requirements

### Requirement: Field-weighted BM25 ranking
The store SHALL rank matching chunks by BM25 with per-field weights that favor heading metadata over body text, returning results ordered from most to least relevant (lower score = more relevant).

#### Scenario: Default field weights applied
- **WHEN** a search runs without explicit field weights
- **THEN** the heading-path field is weighted 8, the leaf-heading field 4, and the body field 1
- **AND** a chunk matching in its heading path ranks above an otherwise-equal chunk matching only in its body

#### Scenario: Caller overrides field weights
- **WHEN** the caller supplies field weights for headingPath, heading, and body
- **THEN** each weight is coerced to a finite number and clamped to the range 0..1000 before ranking
- **AND** a non-finite or missing weight falls back to its default (8 / 4 / 1)

#### Scenario: Results ordered by relevance
- **WHEN** multiple chunks match the query
- **THEN** hits are returned in ascending score order (most relevant first)
- **AND** each hit carries a highlighted snippet drawn from the body field

### Requirement: Query matching, tokenization, and empty results
The store SHALL build a full-text match by OR-ing the query's tokenized terms and SHALL return an empty result set when the query yields no usable terms. Tokenization lowercases the query, keeps alphanumeric runs of length ≥ 2, and drops a fixed stopword set (e.g. the, for, and, how, what, with, use, using) from the match terms. If stopword filtering removes every term, the store falls back to the raw alphanumeric terms so a stopword-only query still matches.

#### Scenario: Multi-term query broadens recall
- **WHEN** the query contains several words
- **THEN** the store matches chunks containing any of the tokenized (stopword-filtered) terms
- **AND** BM25 ranks chunks matching more/rarer terms higher

#### Scenario: Stopwords excluded from match terms
- **WHEN** the query contains stopwords (e.g. "what is the for")
- **THEN** those stopwords are dropped from the OR-ed match terms
- **AND** only the surviving content terms drive the search

#### Scenario: Stopword-only query falls back to raw terms
- **WHEN** every tokenized term is a stopword and would otherwise leave no terms
- **THEN** the store falls back to the raw alphanumeric terms (length ≥ 2) so the query still executes

#### Scenario: Query with no usable terms
- **WHEN** the query produces no alphanumeric terms of length ≥ 2
- **THEN** the store returns an empty list without executing a search

#### Scenario: Result count bounded
- **WHEN** a search runs without an explicit limit
- **THEN** at most 10 hits are returned
- **AND** an explicit limit is clamped to the range 1..1000

### Requirement: Stem-based (porter) matching
The store SHALL match query terms against chunks by word stem, because the FTS5 table is created with `tokenize='porter unicode61'`. A query term and an indexed term that share a Porter stem match even when their surface forms differ.

#### Scenario: Inflected query term matches stem
- **WHEN** the query term is an inflected form (e.g. "running")
- **THEN** it matches chunks containing another form of the same stem (e.g. "run" or "runs")
- **AND** ranking still applies BM25 over the stem-matched chunks

### Requirement: Query expansion
The store SHALL expand the query before building the match according to `opts.queryExpansion`, which selects one of the modes `off` | `agent` | `synonym` | `prf` (default `off`). Expansion has no model dependency and only ever appends terms to the original query.

#### Scenario: Expansion off or agent is pass-through
- **WHEN** queryExpansion is `off` or `agent`
- **THEN** the query is used unchanged (the `agent` mode assumes the caller already reformulated it)

#### Scenario: Synonym glossary expansion
- **WHEN** queryExpansion is `synonym` and the caller supplies a `synonyms` glossary
- **THEN** for each tokenized query term, its glossary synonyms are appended to the query before matching
- **AND** when no synonyms are found, the original query is used unchanged

#### Scenario: PRF handled by caller
- **WHEN** queryExpansion is `prf`
- **THEN** the engine returns the query unchanged (pseudo-relevance feedback is applied by callers via a second pass)

### Requirement: Scoped filtering
The store SHALL restrict results to a given source root and/or document type when the caller requests it.

#### Scenario: Filter by root
- **WHEN** the caller supplies a root filter
- **THEN** only chunks belonging to that root are returned

#### Scenario: Filter by document type
- **WHEN** the caller supplies a docType filter
- **THEN** only chunks of that document type (doc, agents, or source-md) are returned

### Requirement: Exact-content dedup
The store SHALL, by default, collapse chunks with identical body content into a single hit, preferring higher-priority roots and recording the collapsed duplicate paths.

#### Scenario: Duplicate bodies collapsed
- **WHEN** two or more matching chunks share identical body content
- **THEN** a single representative hit is returned
- **AND** the paths of the collapsed duplicates are attached to that hit as alternate paths

#### Scenario: Root priority decides the survivor
- **WHEN** duplicate chunks span multiple roots and the caller provides a root priority map
- **THEN** the chunk from the highest-priority root is kept as the representative
- **AND** ties are broken by best (lowest) score

#### Scenario: Dedup disabled
- **WHEN** the caller disables dedup
- **THEN** every matching chunk is returned individually with no duplicate collapsing

### Requirement: Proximity boost
The store SHALL, when proximity boost is enabled, reward hits whose query terms appear close together and in query order within the body, improving their rank. Proximity uses the same tokenization as matching, so stopwords are excluded from the proximity terms.

#### Scenario: Terms appear near and in order
- **WHEN** proximity boost is enabled and a body contains all (stopword-filtered) query terms in query order within a small window
- **THEN** that hit's score is reduced (improved) by up to 2, with a tighter window giving a larger boost
- **AND** a query of fewer than two terms produces no proximity change

### Requirement: Lexical diversity (MMR)
The store SHALL, when diversity is enabled, re-order the ranked hits to reduce redundancy using maximal marginal relevance balanced by a caller-supplied lambda.

#### Scenario: Redundant hits demoted
- **WHEN** diversity is enabled with a lambda and the ranked list exceeds the working size
- **THEN** each successive hit is chosen to balance BM25 relevance against textual similarity to already-selected hits
- **AND** the top-ranked hit is always retained as the first result

### Requirement: Parent-context expansion
The store SHALL, when parent expansion is enabled, attach each hit's parent chunk as additional context and SHALL never expose the internal parent-chunk id on returned hits.

#### Scenario: Parent attached
- **WHEN** parent expansion is enabled and a hit has a distinct parent chunk
- **THEN** that hit carries its parent section/file as attached context
- **AND** the parent's own chunk id differs from the hit's chunk id

#### Scenario: Internal parent id hidden
- **WHEN** any search completes
- **THEN** the internal parent-chunk id is removed from every returned hit

### Requirement: Optional rerank hook
The store SHALL apply an injected reranker to the BM25 top hits only when rerank is requested and a synchronous reranker is provided, otherwise preserving BM25 order.

#### Scenario: Synchronous reranker reorders
- **WHEN** rerank is requested and a synchronous reranker is injected
- **THEN** the reranker's returned ordering replaces the BM25 ordering

#### Scenario: No or async reranker is a no-op
- **WHEN** rerank is requested but no reranker is injected, or the injected reranker returns a promise
- **THEN** the BM25 ordering is preserved unchanged

### Requirement: Graph neighbors and backlinks
The store SHALL traverse the indexed node/edge graph to return outbound neighbors within a depth bound and inbound backlinks for a named node, excluding the node itself.

#### Scenario: Neighbors within depth
- **WHEN** neighbors are requested for a node with a depth
- **THEN** distinct nodes reachable by outbound edges within that depth are returned
- **AND** the queried node itself is excluded from the results

#### Scenario: Neighbors filtered by relation
- **WHEN** a relation type is supplied
- **THEN** traversal follows only edges of that relation

#### Scenario: Backlinks
- **WHEN** backlinks are requested for a node
- **THEN** the distinct nodes with an edge pointing to that node are returned
