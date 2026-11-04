## MODIFIED Requirements

### Requirement: Proximity boost
The store SHALL, when proximity boost is enabled, reward hits whose query terms appear close together and in query order within the body, improving their rank. Proximity uses the same tokenization as matching, so stopwords are excluded from the proximity terms.

#### Scenario: Terms appear near and in order
- **WHEN** proximity boost is enabled and a body contains all (stopword-filtered) query terms in query order within a small window
- **THEN** that hit's score is reduced (improved) by up to 2, with a tighter window giving a larger boost
- **AND** a query of fewer than two terms produces no proximity change

#### Scenario: The boost reflects the smallest in-order window
- **WHEN** a body contains several in-order occurrences of the query terms
- **THEN** the window measured SHALL be the smallest `last − first` token distance over all non-decreasing position chains, one position per query term (unchanged from the existing behaviour, including its treatment of repeated query terms and equal positions)
- **AND** a body missing any query term SHALL receive no proximity change

## ADDED Requirements

### Requirement: Proximity scoring has bounded cost
Proximity scoring SHALL NOT take time exponential in the number of query terms or in per-term occurrence counts. One search call SHALL stop starting new proximity computations once a fixed proximity-time budget, summed across all lanes, is spent.

#### Scenario: Pathological repeated terms complete promptly
- **WHEN** proximity boost is enabled and a candidate body repeats each of at least 10 query terms at least 100 times, interleaved
- **THEN** the search SHALL return in under 100 ms
- **AND** the boost applied SHALL equal the boost of the smallest in-order window

#### Scenario: Exhausted proximity budget degrades to plain relevance
- **WHEN** the proximity time budget is spent part-way through the candidate list
- **THEN** the remaining candidates SHALL keep their plain BM25 score
- **AND** no candidate SHALL be removed and the search SHALL NOT throw

#### Scenario: Zero budget skips proximity for every candidate
- **WHEN** the proximity time budget is zero or less
- **THEN** every candidate SHALL keep its plain BM25 score

### Requirement: Proximity budget expiry is logged
When the proximity time budget is spent during a search call and at least one candidate was therefore scored without proximity, the store SHALL emit exactly one log line for that call, without changing the shape of the search result.

#### Scenario: Budget expiry is logged once
- **WHEN** the proximity time budget is spent during one search call, however many candidates are left unboosted
- **THEN** exactly one log line SHALL be written for that call, stating the budget and how many of the candidates examined across both lanes were scored without proximity
- **AND** a search call whose proximity work finishes within the budget SHALL write no such line

#### Scenario: No log line when nothing was skipped
- **WHEN** a search call skips no candidate because of the proximity budget — including `proximityBoost` disabled, or a query of fewer than two terms, even with a budget of zero
- **THEN** no proximity-budget log line SHALL be written for that call
