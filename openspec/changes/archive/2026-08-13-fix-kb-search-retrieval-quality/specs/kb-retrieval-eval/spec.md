## ADDED Requirements

### Requirement: Result-Redundancy Metrics
The evaluator SHALL report how much of each result page is occupied by repeated sources, so that redundancy regressions are detectable independently of precision and recall. Precision and recall are blind to redundancy by construction: a query whose correct answer is at rank 1 scores identically whether the remaining slots hold distinct sources or repeats of rank 1.

#### Scenario: Distinct sources per page
- **WHEN** evaluation completes
- **THEN** the report SHALL include the mean number of distinct `(root, path)` sources per top-K result page

#### Scenario: Duplicate-slot share
- **WHEN** evaluation completes
- **THEN** the report SHALL include the fraction of result slots occupied by a source already present earlier on the same page
- **AND** a page whose every slot names a distinct source SHALL contribute a duplicate-slot share of zero

#### Scenario: Single-source page rate
- **WHEN** evaluation completes
- **THEN** the report SHALL include the fraction of queries whose entire top-K page comes from one source

#### Scenario: Redundancy metrics are reported alongside ranking metrics
- **WHEN** evaluation completes
- **THEN** redundancy metrics SHALL appear in the same aggregate report as P@1, P@5, Recall@K, MRR, and nDCG@K

### Requirement: Bundled Golden-Set Fixtures
The repository SHALL ship golden-set fixtures covering both retrieval intents observed in practice, so ranking changes are gated on measured behaviour rather than intuition. Fixtures SHALL be derived from implicit relevance feedback — the file an agent opened after a search — and SHALL record their provenance and known sampling biases.

#### Scenario: Markdown-intent fixture
- **WHEN** the bundled fixtures are loaded
- **THEN** a golden set SHALL be available whose expected targets are markdown documents

#### Scenario: Source-intent fixture
- **WHEN** the bundled fixtures are loaded
- **THEN** a golden set SHALL be available whose expected targets are source files reached via their `AGENTS.md` record

#### Scenario: Fixture provenance is recorded
- **WHEN** a fixture is inspected
- **THEN** it SHALL document how its query/target pairs were derived
- **AND** it SHALL document that pairs are biased toward queries that succeeded well enough to produce an opened file, so abandoned searches are under-represented

#### Scenario: Fixtures gate ranking changes
- **WHEN** a change alters ranking, dedup, expansion, or the lane quota
- **THEN** the bundled fixtures SHALL be evaluated before and after
- **AND** a drop in Recall@K or a rise in duplicate-slot share SHALL be treated as a regression

## MODIFIED Requirements

### Requirement: Retrieval Quality Metrics
The evaluator SHALL compute precision, recall, and ranking-quality metrics from the per-query first-match rank, aggregated across the golden set, and SHALL report result-redundancy metrics alongside them so that page composition is visible and not only page correctness.

#### Scenario: P@1
- **WHEN** the first matching result is at rank 1
- **THEN** the query counts toward P@1
- **AND** P@1 is the fraction of golden items with a rank-1 match

#### Scenario: P@5
- **WHEN** the first matching result is at a rank between 1 and 5 inclusive
- **THEN** the query counts toward P@5
- **AND** P@5 is the fraction of golden items matched within the top 5

#### Scenario: Recall@K
- **WHEN** a matching result appears anywhere within the top-K
- **THEN** the query counts toward Recall@K
- **AND** Recall@K is the fraction of golden items with any in-window match

#### Scenario: MRR
- **WHEN** a query has a matching result at a given rank
- **THEN** it contributes the reciprocal of that rank
- **AND** MRR is the mean reciprocal rank across the golden set

#### Scenario: nDCG@K
- **WHEN** a query has a matching result at a given rank
- **THEN** it contributes a discounted gain based on that rank with an ideal gain of 1 for a single relevant target
- **AND** nDCG@K is the mean discounted gain across the golden set

#### Scenario: Redundancy reported with quality
- **WHEN** the aggregate report is produced
- **THEN** it SHALL carry the result-redundancy metrics in addition to the ranking metrics
