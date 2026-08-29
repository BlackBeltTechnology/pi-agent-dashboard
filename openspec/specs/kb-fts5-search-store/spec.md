# kb-fts5-search-store Specification

## Purpose
The FTS5 search store provides full-text search over indexed markdown chunks using BM25 field-weighted ranking, with optional query expansion, dedup, lexical diversity, proximity boost, parent-context expansion, and a pluggable rerank hook. A result page is bounded to `limit` distinct SOURCES rather than chunks: exact-content dedup collapses byte-identical bodies, source-level dedup then keeps one representative per `(root, path)`, and a configurable share of the page is reserved for an independently-ranked `agents` document-type lane. Coverage-weighted reranking and pseudo-relevance-feedback expansion are implemented but opt-in. Matching is stem-based via the FTS5 `porter unicode61` tokenizer, and match/proximity terms exclude a fixed stopword set. It also answers graph queries (neighbors, backlinks) over the node/edge relations built during indexing.
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

### Requirement: Scoped filtering
The store SHALL restrict results to a given source root and/or document type when the caller requests it.

#### Scenario: Filter by root
- **WHEN** the caller supplies a root filter
- **THEN** only chunks belonging to that root are returned

#### Scenario: Filter by document type
- **WHEN** the caller supplies a docType filter
- **THEN** only chunks of that document type (doc, agents, or source-md) are returned

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
The store SHALL expose graph traversal from a named node and reverse lookup of nodes linking to it, and SHALL expose chunk retrieval by path that never silently discards matching sections.

#### Scenario: Neighbors within depth
- **WHEN** the caller requests neighbors of a node with a depth
- **THEN** nodes reachable within that depth are returned, excluding the origin node

#### Scenario: Neighbors filtered by relation
- **WHEN** a relation type is supplied
- **THEN** traversal follows only edges of that relation

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

### Requirement: Property-filtered search
The store SHALL accept optional structured filters and restrict full-text results
to files whose stored properties satisfy every filter. Filter values SHALL be
bound as SQL parameters. When no filters are supplied, results MUST be identical
to the unfiltered query.

#### Scenario: Exact / IN filter intersects full-text hits
- **WHEN** the caller supplies an `eq` or `in` filter on a facet key
- **THEN** only hits whose file has a matching normalized property `value` are
  returned, intersected with the full-text matches by `(root, path)`

#### Scenario: Range filter on a typed key
- **WHEN** the caller supplies a `gte`/`lte` filter on a key declared numeric or
  date
- **THEN** only hits whose file has a `value_num`/`value_date` satisfying the bound
  are returned

#### Scenario: Parameter binding
- **WHEN** a filter value contains SQL metacharacters
- **THEN** it is passed as a bound parameter and cannot alter the executed SQL

#### Scenario: Absent filters are a no-op
- **WHEN** no filters are supplied
- **THEN** the executed query, ranking, and returned hits equal the pre-change
  behavior

### Requirement: Facet aggregation
The store SHALL return, on request, a map of value→count per requested facet key,
where each count is the number of distinct files carrying that value over the
current (optionally filtered) result set.

#### Scenario: Counts per value are distinct-file counts
- **WHEN** the caller requests facets for one or more configured keys
- **THEN** for each key a `value → count` map is returned, reflecting any active
  filters
- **AND** a value repeated within a single file contributes 1 to its count, not N

### Requirement: Schema version gate
The store SHALL record a schema version via `PRAGMA user_version` together with a
facet-configuration hash, and SHALL force a full reindex when either differs from
the current values, then stamp the current values. Existing `chunks`, `nodes`, and
`edges` tables SHALL be unaffected by this change.

#### Scenario: Stale version forces reindex
- **WHEN** the stored `user_version` is older than the current schema version, or
  the stored facet-config hash differs
- **THEN** a full reindex is performed to populate the properties store and
  synthetic meta chunks, and the current version and config hash are stamped

#### Scenario: Up-to-date store skips forced reindex
- **WHEN** the stored version and facet-config hash both match
- **THEN** no forced reindex is triggered by this gate

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

### Requirement: Hits carry a trust verdict
A search hit SHALL carry a trust verdict describing whether the source files documented by the hit's resolvable DOX rows are still accurate on disk. The verdict SHALL be one of `FRESH`, `STALE`, `MOVED`, `GONE`, or `UNVERIFIED` when the hit has at least one resolvable subject row, and SHALL be null when it does not. The verdict SHALL be individually disableable by the caller.

#### Scenario: Subject unchanged since it was documented
- **WHEN** every checked subject of a hit exists on disk and its content matches the hash recorded when its row was acknowledged
- **THEN** the hit SHALL report verdict `FRESH`

#### Scenario: Subject changed since it was documented
- **WHEN** a checked subject exists on disk but its content no longer matches the acknowledged hash
- **THEN** the hit SHALL report verdict `STALE`

#### Scenario: Subject was renamed
- **WHEN** a checked subject is absent from disk and rename detection identifies exactly one successor path
- **THEN** the hit SHALL report verdict `MOVED`
- **AND** the hit SHALL report the successor path

#### Scenario: Subject is gone
- **WHEN** a checked subject is absent from disk and no unambiguous successor is identified, or the subject lies outside any git repository
- **THEN** the hit SHALL report verdict `GONE`

#### Scenario: No acknowledged hash exists
- **WHEN** a checked subject exists but has no acknowledged hash to compare against
- **THEN** the hit SHALL report verdict `UNVERIFIED`
- **AND** the absence of a hash SHALL NOT be reported as a change

#### Scenario: Hit has no resolvable subject
- **WHEN** a hit is prose that documents no source file
- **THEN** the hit SHALL report a null verdict rather than an inferred one

### Requirement: A hit's verdict aggregates its subject set
The chunker emits heading sections, not table rows, so a hit of doc_type `agents` typically contains many DOX rows. A hit's subject set SHALL be the source files its resolvable rows document, in row order, capped at 8 subjects per hit. The hit's verdict SHALL be the worst-of the per-subject labels in the order `GONE` > `MOVED` > `STALE` > `UNVERIFIED` > `FRESH`, and SHALL carry per-label counts over the checked set TOGETHER WITH the total count of resolvable subjects, so a capped check is never indistinguishable from a full one.

#### Scenario: Worst-of aggregation with counts
- **WHEN** a hit's checked subject set contains two stale subjects, five fresh, and one gone
- **THEN** the hit SHALL report verdict `GONE`
- **AND** the hit SHALL report counts making the 2-stale / 5-fresh / 1-gone composition visible

#### Scenario: Subject cap is visible
- **WHEN** a hit's section documents more than 8 resolvable files
- **THEN** exactly the first 8 rows in row order SHALL be checked
- **AND** the counts SHALL state both how many subjects were checked and how many the section documents in total

### Requirement: Verdicts label but never rank
A trust verdict SHALL NOT influence result ordering. The sequence of hits returned with verdicts enabled SHALL be identical to the sequence returned with verdicts disabled for the same query and options.

#### Scenario: Ordering is unchanged by verdicts
- **WHEN** the same query runs with verdicts enabled and disabled
- **THEN** the returned hits SHALL appear in the same order in both cases

#### Scenario: A stale hit is not demoted
- **WHEN** the best-scoring hit for a query reports verdict `STALE` or `GONE`
- **THEN** it SHALL still be returned at rank 1
- **AND** it SHALL be labelled rather than suppressed

### Requirement: Verdict enrichment is a post-search stage, read-only and bounded
Verdict computation SHALL NOT live inside the store's synchronous search path. It SHALL run as an asynchronous post-search enrichment step. It SHALL NOT write to the index or the filesystem. Freshness SHALL be decided by content hash whenever a hash is computed; a persisted stat baseline recorded at acknowledgement time MAY skip the read but SHALL NOT by itself decide a freshness label except where hashing is impossible. Subjects larger than 1 MB, or detected as binary, SHALL NOT be hashed. Content-coverage scoring, when enabled, SHALL cap the bytes read from a subject file and SHALL skip binary content.

#### Scenario: Enrichment never mutates state
- **WHEN** a search runs with verdicts enabled and some hits report `STALE`, `MOVED`, or `GONE`
- **THEN** no index rows SHALL be inserted, updated, or deleted
- **AND** no file on disk SHALL be created, modified, or removed

#### Scenario: A matching stat baseline skips the read
- **WHEN** a subject's recorded size and modification time match its persisted acknowledgement baseline
- **THEN** the subject's content SHALL NOT be read or hashed

#### Scenario: Oversized and binary subjects are never hashed
- **WHEN** a subject exceeds 1048576 bytes (1 MiB) or is detected as binary
- **THEN** its content SHALL NOT be hashed
- **AND** with a matching stat baseline it SHALL report `FRESH`, otherwise `UNVERIFIED`

#### Scenario: Enrichment latency is recorded against an advisory target
- **WHEN** verdict enrichment runs over a default page whose checked subjects all exist — the median case, with stat-gated hashing, the 8-subject cap, and the hash cap
- **THEN** the measured MEDIAN SHALL be recorded against the advisory 15 ms target in the change's measurements
- **AND** the target SHALL NOT gate CI — it is advisory by decision, not a SHALL
- **AND** rename detection SHALL be batched — one rename-scan subprocess per repository per enrichment, not one per subject — so absent subjects cost the batch, not a spawn each
- **AND** the shipped search latency budget is unchanged because the store's search path is untouched

### Requirement: Content coverage is a separate, opt-in signal
Content-coverage scoring — whether the query's terms appear in a subject file — SHALL be reported as a field distinct from the freshness verdict, and SHALL be disabled by default until calibrated against the bundled golden sets.

#### Scenario: Coverage is off by default
- **WHEN** a search runs with default options
- **THEN** no subject file SHALL be read for coverage scoring

#### Scenario: Coverage does not change the freshness verdict
- **WHEN** coverage scoring is enabled and a subject has low coverage for the query
- **THEN** the freshness verdict SHALL be unaffected
- **AND** coverage SHALL be reported in its own field

