## ADDED Requirements

### Requirement: Opt-In Per-Item Results
The evaluation SHALL, only when the caller requests it, return one per-item record for every searched golden item — its query text, expected path, first-match rank (0 when no match within top-K) and duplicate-slot share of its result page — in golden-set order, excluding unreachable items. When not requested, the evaluation output SHALL be byte-identical to the output without this feature, so the `kb eval` CLI report is unchanged.

#### Scenario: Per-item records accompany aggregates when requested
- **WHEN** a golden set of 5 reachable items is evaluated with per-item output requested and the first matches sit at ranks 1, 3, none, 2, none
- **THEN** the per-item ranks are `[1, 3, 0, 2, 0]`, each paired with its query text
- **AND** the aggregate metrics equal those of the same evaluation without per-item output

#### Scenario: Unreachable items are absent from per-item output
- **WHEN** a golden set has 4 items of which 1 is unreachable and per-item output is requested
- **THEN** there are 3 per-item records

#### Scenario: Default output unchanged
- **WHEN** per-item output is not requested
- **THEN** the returned report has no per-item field

### Requirement: Deterministic Evolve / Held-Out Split
Per-item records SHALL be partitioned into an evolve split and a held-out split by `SHA-1(lowercase(trim(q)))`, reading the first 4 digest bytes as an unsigned big-endian integer divided by 2^32: values below the held-out fraction (default 0.3) are held-out. Records with a query text already seen earlier in the same fixture SHALL be dropped before splitting.

#### Scenario: Split is stable across runs and reorderings
- **WHEN** the same records are split twice, once shuffled
- **THEN** every query lands in the same split both times

#### Scenario: Duplicate queries are counted once
- **WHEN** a fixture contains the same query text twice
- **THEN** only the first record takes part in the split and in every statistic

### Requirement: Noise-Adjusted Paired Verdicts
Comparing a candidate to a baseline over the same records SHALL use a seeded paired bootstrap (default seed 1, 2000 resamples) of the per-record difference of a signal, for three signals: reciprocal rank, hit (rank > 0), and negated duplicate-slot share. For each signal it SHALL report the 95% interval and yield `gain` when its lower bound is above 0, `regress` when the upper bound of the 80% interval is below 0, otherwise `noise`. Identical seed and inputs SHALL yield identical bounds and verdicts.

#### Scenario: Identical configs are noise
- **WHEN** candidate records equal baseline records
- **THEN** every signal's verdict is `noise`

#### Scenario: Consistent improvement is a gain
- **WHEN** 40 records are compared and the candidate moves 30 of them from rank 3 to rank 1 and changes nothing else
- **THEN** the reciprocal-rank verdict is `gain`

#### Scenario: Tiny improvement on few items is noise
- **WHEN** the candidate improves exactly 1 of 100 records from rank 2 to rank 1 and changes nothing else
- **THEN** the reciprocal-rank verdict is `noise`

#### Scenario: Recall loss is caught even with an MRR gain
- **WHEN** 40 records are compared and the candidate moves 20 records from rank 3 to rank 1 and 12 records from rank 5 to a miss
- **THEN** the hit verdict is `regress`

#### Scenario: Deterministic under seed
- **WHEN** the same comparison is run twice with the same seed
- **THEN** both runs report identical bounds and verdicts

### Requirement: Candidate Acceptance Rule
A candidate SHALL be accepted only if (a) its reciprocal-rank verdict over the pooled evolve records of both bundled fixtures is `gain`, and (b) no signal is `regress` on any fixture's evolve or held-out split. When the candidate's median per-query latency exceeds the baseline's by both the configured ratio (default 1.25) and at least 0.5 ms, it SHALL additionally require a reciprocal-rank `gain` over the pooled held-out records. Rejections SHALL name every failing fixture, split, signal and rule. This rule is the regression criterion of the existing "Fixtures gate ranking changes" scenario made measurable.

#### Scenario: Gain in one lane, regression in the other is rejected
- **WHEN** a candidate is a pooled evolve `gain` but reciprocal rank is `regress` on source-intent held-out
- **THEN** the candidate is rejected naming source-intent, held-out, reciprocal rank

#### Scenario: Pooled gain with no regression is accepted
- **WHEN** a candidate is a pooled evolve `gain`, no signal regresses anywhere, and latency is within the ratio
- **THEN** the candidate is accepted

#### Scenario: Slower candidate must prove itself held-out
- **WHEN** a candidate is 1.5× and 2 ms slower than baseline and its pooled held-out verdict is `noise`
- **THEN** the candidate is rejected citing the cost rule

### Requirement: Experiment Ledger
A gated run given hypothesis text SHALL write one new ledger record file (never modifying existing records) containing: timestamp, hypothesis, baseline and candidate labels and config overrides, bootstrap seed, per-fixture per-split per-signal intervals and verdicts, latency medians and ratio, decision and rejection reasons, git commit, whether the working tree was dirty plus a hash of the uncommitted diff, a hash of the golden fixture files, and the index file and chunk counts. A gated run without hypothesis text SHALL report its decision and write nothing.

#### Scenario: Gated run with hypothesis writes a complete record
- **WHEN** a candidate is gated with a hypothesis
- **THEN** exactly one new record file exists containing every listed field
- **AND** no existing record file changed

#### Scenario: Dry run writes nothing
- **WHEN** a candidate is gated without hypothesis text
- **THEN** the decision is printed and no record file is written
