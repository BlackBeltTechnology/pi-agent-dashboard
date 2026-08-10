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
The evaluator SHALL compute precision, recall, and ranking-quality metrics from the per-query first-match rank, aggregated across the golden set.

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
