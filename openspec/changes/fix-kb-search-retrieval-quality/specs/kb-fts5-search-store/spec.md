## ADDED Requirements

### Requirement: Source-level dedup
The store SHALL, by default, return at most one hit per source `(root, path)`, keeping the best-scoring chunk as the representative and recording how many further matching sections of that source were suppressed. Source-level dedup SHALL be applied after exact-content dedup, so cross-root duplicates collapse into alternate paths before sources are collapsed. Source-level dedup SHALL be individually disableable by the caller.

#### Scenario: One hit per source
- **WHEN** several matching chunks belong to the same `(root, path)`
- **THEN** exactly one representative hit for that source SHALL be returned
- **AND** the representative SHALL be the best (lowest) scoring chunk of that source
- **AND** the hit SHALL carry the count of suppressed sections from that source

#### Scenario: Suppressed count is zero when a source matches once
- **WHEN** a source contributes exactly one matching chunk
- **THEN** the hit SHALL report a suppressed-section count of zero

#### Scenario: Applied after exact-content dedup
- **WHEN** the same section exists under two roots and both survive matching
- **THEN** exact-content dedup SHALL collapse them into one hit carrying alternate paths first
- **AND** source-level dedup SHALL then operate over the already-collapsed hits

#### Scenario: Source dedup disabled
- **WHEN** the caller disables source-level dedup
- **THEN** every matching chunk SHALL be returned individually, subject to the other ranking stages

### Requirement: Result limit counts distinct sources
The `limit` option SHALL bound the number of distinct sources returned, not the number of chunks. The store SHALL fetch a candidate pool proportionally deeper than `limit` so that source collapsing does not starve the result page, bounded by the existing candidate ceiling.

#### Scenario: Limit bounds sources
- **WHEN** a search runs with `limit: N` and source-level dedup enabled
- **THEN** at most `N` distinct `(root, path)` sources SHALL be returned

#### Scenario: Candidate pool scales with limit
- **WHEN** source-level dedup is enabled
- **THEN** the underlying candidate fetch SHALL be a multiple of `limit` (not `limit` itself)
- **AND** the fetch SHALL remain bounded by the candidate ceiling

#### Scenario: Search latency budget
- **WHEN** a search runs with default options over an index of ~22,000 chunks
- **THEN** the MEDIAN search SHALL complete within 50 ms
- **AND** the budget is stated as a median because the reserved `agents` lane is a second FTS query and `doc_type` is an unindexed column, so its cost is a full scan of the match set: measured 53.2 ms median / 84.8 ms p95 over a 31,121-chunk index, which scales to ~38 ms median / ~60 ms p95 at ~22,000 chunks
- **AND** the p95 overage is accepted deliberately, because removing the lane would forfeit source-intent Recall@K 0.500 → 0.317

### Requirement: Document-type lane quota
The store SHALL, by default, reserve a configurable share of the result page for `agents` document-type hits, interleaving a separately-ranked `agents` lane with the unrestricted lane, without requiring the caller to pass a `docType` filter. The quota SHALL be skipped when the caller supplies an explicit `docType` filter. When one lane yields fewer candidates than its share, the other lane SHALL fill the remaining slots.

#### Scenario: Agents lane is reserved without a filter
- **WHEN** a search runs with no `docType` filter and `agents` chunks match the query
- **THEN** the result page SHALL contain `agents` hits up to the configured share
- **AND** those hits SHALL be ranked within their own lane before interleaving

#### Scenario: Explicit docType filter bypasses the quota
- **WHEN** the caller supplies a `docType` filter
- **THEN** only chunks of that document type SHALL be returned and no lane interleaving SHALL occur

#### Scenario: Starved lane yields its slots
- **WHEN** one lane produces fewer candidates than its configured share
- **THEN** the other lane SHALL fill the remaining slots up to `limit`

#### Scenario: Quota share is configurable
- **WHEN** the configuration supplies a lane share
- **THEN** that share SHALL determine the interleave ratio
- **AND** a share of zero SHALL disable the quota entirely

### Requirement: Coverage-weighted reranking
The store SHALL support reranking the BM25 candidate pool by IDF-weighted coverage of the original query terms, using BM25 score as the tiebreak. Coverage SHALL be computed over the heading path and body of each candidate. Coverage reranking SHALL be individually enableable and SHALL be **disabled by default**.

Default-off is a measured decision, not an omission. On the bundled golden sets coverage reranking is clearly beneficial for source-intent retrieval (P@5 0.337 → 0.394, MRR 0.198 → 0.254) and clearly harmful for markdown-intent retrieval (Recall@K 0.630 → 0.491). A corpus that is overwhelmingly `doc` chunks loses more than it gains, so the engine ships the trade OFF and exposes it to a deployment whose query mix differs. See `openspec/changes/fix-kb-search-retrieval-quality/measurements.md`.

IDF SHALL be derived from the corpus document frequency of the query terms' **tokenizer-normalised** forms, because the full-text index stores stemmed terms and a raw-token lookup silently reports a document frequency of zero.

#### Scenario: Broader coverage outranks concentrated matches
- **WHEN** one candidate contains many distinct query terms once each and another repeats a single query term
- **THEN** the candidate covering more of the query (weighted by term IDF) SHALL rank higher

#### Scenario: BM25 breaks coverage ties
- **WHEN** two candidates have equal IDF-weighted coverage
- **THEN** the lower (better) BM25 score SHALL rank first

#### Scenario: Coverage rerank disabled
- **WHEN** coverage reranking is disabled
- **THEN** candidates SHALL retain their BM25 ordering

#### Scenario: Coverage rerank is off unless requested
- **WHEN** a caller performs a search without selecting a reranking mode
- **THEN** coverage reranking SHALL NOT be applied

#### Scenario: Document frequency resolves the indexed term form
- **WHEN** IDF is computed for a query term whose indexed form differs from the raw token
- **THEN** the document frequency SHALL be looked up by the indexed (stemmed) form
- **AND** a term genuinely absent from the corpus SHALL report a document frequency of zero

## MODIFIED Requirements

### Requirement: Query expansion
The store SHALL expand the query before building the match according to `opts.queryExpansion`, which selects one of the modes `off` | `agent` | `synonym` | `prf` (**default `off`**). Expansion has no model dependency and only ever appends terms to the original query. In `prf` mode the store SHALL perform pseudo-relevance feedback itself: it SHALL mine the top-ranked candidates of a first pass for terms absent from the query whose document frequency is at or below a configured corpus share, rank those candidates by frequency times IDF, append the highest-ranked terms, and re-retrieve. PRF expansion SHALL only be applied when coverage-weighted reranking is enabled, because expanding an OR-query without coverage reranking degrades precision.

`prf` is implemented and opt-in rather than default, for the same measured reason as coverage reranking, on which it depends: it lifts source-intent precision (P@5 0.394 → 0.481) while markdown-intent Recall@K stays below the un-reranked baseline, and it costs roughly three times the search latency. See `openspec/changes/fix-kb-search-retrieval-quality/measurements.md`.

PRF SHALL NOT mine feedback terms from a candidate set too small to constitute one, since the "top-ranked" documents would then be the entire result and the mined terms carry no discriminating signal.

#### Scenario: Expansion off or agent is pass-through
- **WHEN** queryExpansion is `off` or `agent`
- **THEN** the query is used unchanged (the `agent` mode assumes the caller already reformulated it)

#### Scenario: Synonym glossary expansion
- **WHEN** queryExpansion is `synonym` and the caller supplies a `synonyms` glossary
- **THEN** for each tokenized query term, its glossary synonyms are appended to the query before matching
- **AND** when no synonyms are found, the original query is used unchanged

#### Scenario: PRF mines feedback terms from a first pass
- **WHEN** queryExpansion is `prf`
- **THEN** the store SHALL run a first retrieval pass, collect terms from the top candidates that are absent from the query and below the corpus-frequency ceiling, rank them by frequency times IDF, and append the top-ranked terms before re-retrieving
- **AND** the number of appended terms SHALL be bounded by configuration

#### Scenario: PRF requires coverage reranking
- **WHEN** queryExpansion is `prf` and coverage-weighted reranking is disabled
- **THEN** the store SHALL NOT apply PRF expansion and SHALL use the original query

#### Scenario: Expansion is off unless requested
- **WHEN** a caller performs a search without selecting an expansion mode
- **THEN** the query SHALL be used unchanged

#### Scenario: Feedback set too small to mine
- **WHEN** the first pass returns fewer candidates than the minimum feedback-set size
- **THEN** no feedback terms SHALL be appended

#### Scenario: Ranking uses the original query terms
- **WHEN** PRF expansion has appended terms
- **THEN** coverage reranking SHALL weight coverage of the original query terms above coverage of the appended terms

### Requirement: Exact-content dedup
The store SHALL, by default, collapse chunks with identical body content into a single hit, preferring higher-priority roots and recording the collapsed duplicate paths. This collapse operates on body content and is distinct from source-level dedup, which collapses distinct sections of the same file.

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

#### Scenario: Distinct sections of one file are not content duplicates
- **WHEN** two matching chunks belong to the same file but have different bodies
- **THEN** exact-content dedup SHALL NOT collapse them
- **AND** source-level dedup SHALL be responsible for collapsing them

### Requirement: Graph neighbors and backlinks
The store SHALL expose graph traversal from a named node and reverse lookup of nodes linking to it, and SHALL expose chunk retrieval by path that never silently discards matching sections.

#### Scenario: Neighbors within depth
- **WHEN** the caller requests neighbors of a node with a depth
- **THEN** nodes reachable within that depth are returned, excluding the origin node

#### Scenario: Backlinks
- **WHEN** the caller requests backlinks for a node
- **THEN** the distinct nodes with an edge pointing at it are returned

#### Scenario: Chunk fetch by path and section
- **WHEN** the caller requests a chunk by path and heading path
- **THEN** the chunk matching that heading path within that file is returned

#### Scenario: Chunk fetch by path alone reports suppressed sections
- **WHEN** the caller requests a chunk by path without a heading path and the file has more than one chunk
- **THEN** the response SHALL indicate that further sections exist and how many
- **AND** the caller SHALL NOT receive an arbitrary single section with no indication that others were omitted
