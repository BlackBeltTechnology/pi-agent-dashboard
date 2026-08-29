# kb-retrieval-eval Specification

## Purpose
Scores KB search quality against a golden set of query→expected-path items. Runs each query through the store's search and reports aggregate retrieval metrics (P@1, P@5, Recall@K, MRR, nDCG@K) plus average per-query latency, so ranking changes can be gated on measured quality.
## Requirements
### Requirement: Golden-Set Evaluation Input
The evaluator SHALL accept a store, an ordered list of golden items, and search options, and run each golden query through the store's search to produce a single aggregate metrics report.

#### Scenario: Golden item shape
- **WHEN** a golden item is supplied
- **THEN** it provides a query string and an expected path substring the correct result should match
- **AND** the expected substring is matched root-agnostically against result paths

#### Scenario: Cut-off K controls search depth and metric window
- **WHEN** evaluation runs
- **THEN** each query is searched with a limit equal to K (default 10)
- **AND** all K-bounded metrics are computed over that same top-K result window

#### Scenario: Aggregate report shape
- **WHEN** evaluation completes
- **THEN** it returns a report containing n, P@1, P@5, Recall@K, MRR, nDCG@K, and avgLatencyMs
- **AND** n reports the number of golden items supplied
- **AND** ranking metrics are rounded to 3 decimals and avgLatencyMs to 2 decimals

### Requirement: Rank Determination
The evaluator SHALL determine, for each query, the rank of the first result whose path contains the expected substring, and treat the absence of any such result as a miss.

#### Scenario: First matching result
- **WHEN** a query's results are scanned in order
- **THEN** the rank is the 1-based position of the earliest result whose path includes the expected substring

#### Scenario: No matching result within top-K
- **WHEN** no result in the top-K contains the expected substring
- **THEN** the query is treated as a miss and contributes nothing to P@1, P@5, Recall@K, MRR, or nDCG@K

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

### Requirement: Latency Measurement
The evaluator SHALL measure the wall-clock time of each search and report the average latency per query.

#### Scenario: Average latency
- **WHEN** evaluation completes
- **THEN** avgLatencyMs is the total measured search time divided by the number of golden items

### Requirement: Empty Golden Set
The evaluator SHALL produce a well-defined report when given an empty golden set without dividing by zero.

#### Scenario: No golden items
- **WHEN** the golden set is empty
- **THEN** n is reported as 0
- **AND** every quality metric and avgLatencyMs is 0

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

### Requirement: Evaluation SHALL score the same search options the tool uses
The `kb eval` and `kb search` CLI paths SHALL construct their `SearchOpts` from the resolved config via one shared helper, identical to the option set `packages/kb-extension/src/extension.ts` passes to `store.search`. A ranking option that is active for the `kb_search` tool SHALL NOT be silently absent from evaluation.

#### Scenario: Eval applies the configured ranking options
- **WHEN** `kb eval --golden <file>` runs against a config with `ranking.laneQuota` set
- **THEN** the scored search SHALL receive that `laneQuota` together with `fieldWeights`, `proximityBoost`, `diversity`, `sourceDedup`, `coverageRerank`, `queryExpansion`, `expandParent` and `rootPriority`

#### Scenario: A ranking option cannot drift between CLI and tool
- **WHEN** a new ranking option is added to the search path
- **THEN** the CLI and the extension SHALL obtain it from the same shared helper
- **AND** adding it in only one of the two call sites SHALL NOT be possible without changing that helper

### Requirement: Golden fixtures SHALL be accepted in their published shape
`--golden` SHALL accept both a bare array and an object carrying an `items` array, and SHALL reject anything else with a diagnostic naming the expected shape.

#### Scenario: Bundled fixture loads
- **WHEN** `kb eval --golden packages/kb/eval/golden.source-intent.json` runs
- **THEN** the bundled object form SHALL load via its `items` array
- **AND** the run SHALL NOT fail with `golden is not iterable`

#### Scenario: Malformed fixture is reported precisely
- **WHEN** a `--golden` file is neither an array nor an object with `items`
- **THEN** the CLI SHALL exit non-zero naming both accepted shapes

### Requirement: Expected paths SHALL be normalized against configured roots
Scoring SHALL compare a golden `expect` to indexed paths after normalizing the configured source-root prefix, and SHALL report items whose `expect` lies outside every configured root as unreachable rather than as misses.

#### Scenario: Repo-relative expect matches an indexed path
- **WHEN** a fixture item expects `packages/foo/AGENTS.md` and `packages` is a configured root
- **THEN** it SHALL match the indexed path `foo/AGENTS.md`

#### Scenario: Unreachable targets are reported separately
- **WHEN** a fixture item expects a path under a directory that is not a configured root
- **THEN** the item SHALL be counted as unreachable and excluded from precision and recall
- **AND** the unreachable count SHALL appear in the emitted metrics

### Requirement: A vacuous evaluation SHALL fail loudly
An eval run that retrieves nothing for every query SHALL be treated as a harness fault rather than reported as a retrieval score.

#### Scenario: All-zero recall is treated as a harness fault
- **WHEN** an eval run scores Recall@K of 0 across the entire golden set
- **THEN** the CLI SHALL exit non-zero with a diagnostic naming fixture shape and root normalization as likely causes

### Requirement: The built CLI artifact SHALL NOT lag its source
The `kb` bin and the `kb-extension` tool SHALL run the same engine.

#### Scenario: Stale dist is rejected
- **WHEN** the committed `packages/kb/engine-fingerprint.json` is missing, malformed, or its `srcHash`/`tsconfigHash` no longer match the current source and tsconfig chain
- **THEN** the build or CI check SHALL fail
- **AND** the failure SHALL state that the `kb` bin and the extension would otherwise run different engines

