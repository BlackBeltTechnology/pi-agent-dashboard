## ADDED Requirements

### Requirement: Dense and hybrid variants in the fixture harness

The fixture harness SHALL score `bm25`, `dense`, `hybrid`, and `hybrid-small` (a small text-only embedder) variants over every bundled text golden set, executing the same search routine the CLI uses (asynchronous where the dense leg requires it), reporting the existing metrics plus paired deltas against `bm25` with bootstrap confidence intervals and win/loss/tie counts.

#### Scenario: Paired report
- **WHEN** the harness runs with dense variants enabled
- **THEN** each variant row SHALL carry P@1, P@5, R@10, MRR and duplicate-slot share per set
- **AND** each non-baseline row SHALL carry ΔMRR and ΔR@10 vs `bm25` with 95% CI and W/L/T

#### Scenario: Unvalidated recipe
- **WHEN** the embedding model is not validated for text
- **THEN** the harness SHALL omit dense/hybrid rows and state why

### Requirement: Embedding-unit ablation

The harness SHALL score dense retrieval separately for the `file`, `chunk`, `row`, and `fused` embedding units over the same queries. `row` units SHALL be the DOX table rows of indexed AGENTS files and SHALL resolve to their AGENTS file for scoring; `fused` units SHALL be chunks prefixed by the DOX row naming their file, or the chunk alone when none exists.

#### Scenario: Unit rows
- **WHEN** the ablation runs
- **THEN** the report SHALL contain one row per unit per golden set

### Requirement: Non-click-mined golden sets

The system SHALL bundle a paraphrase golden set of at least 40 items whose queries share no content tokens with their target's heading path and first 200 characters, and an md→image golden set derived from in-repo image references with alt text of at least three words. A corpus-aware check SHALL reject paraphrase items that violate the overlap rule. The harness SHALL embed the referenced repo images into an evaluation-scoped media set through its own embedding-service instance whose allowlist covers the repository root, SHALL score md→image items by matching the returned image path, and SHALL NOT restart or widen a user's running instance.

#### Scenario: Overlap violation
- **WHEN** a paraphrase item's query shares a content token with its target
- **THEN** the corpus-aware check SHALL fail naming the item

#### Scenario: md→image with no media roots configured
- **WHEN** the harness runs the md→image set and `omni.mediaRoots` is empty
- **THEN** the set SHALL still be scored against the evaluation-scoped media set

### Requirement: Private golden sets are generated locally

Text→audio golden sets SHALL be generated on demand from local SRT files into a user-owned directory that resolves outside the repository root, and SHALL NOT be committed. The harness SHALL score them when present and SHALL skip them with a notice when absent.

#### Scenario: Private set absent
- **WHEN** no local text→audio set exists
- **THEN** the harness SHALL report the set as skipped, not as zero

### Requirement: Cost metrics alongside quality

Reports for dense variants SHALL include embedding throughput per modality, vector-plane size in bytes, nearest-neighbour lookup latency p50/p95, and hybrid end-to-end query latency p50/p95.

#### Scenario: Cost columns present
- **WHEN** a dense variant is reported
- **THEN** throughput, size, and latency fields SHALL be non-empty

### Requirement: Adoption decision rules

The report SHALL state recommendations computed by fixed rules. (1) Hybrid is recommended only when ΔMRR on the paraphrase set has a CI excluding zero AND no bundled click-mined set shows a significant MRR or R@10 loss AND duplicate-slot share does not rise significantly on any set. (2) For markdown retrieval, the omni model is recommended over the small text embedder only when its hybrid ΔMRR over `hybrid-small` has a CI excluding zero on the text sets. (3) Media indexing is recommended only when omni beats the transcript/alt-text baselines (BM25 and small text embedder over the transcript or alt text) with a CI excluding zero on at least one media set. The small text embedder SHALL NOT be scored against raw media. Recommendations SHALL NOT change any default.

#### Scenario: Rule not met
- **WHEN** the paraphrase ΔMRR CI includes zero
- **THEN** the report SHALL state "hybrid: not recommended" with the failing condition

#### Scenario: Recall regression blocks recommendation
- **WHEN** paraphrase ΔMRR is significant but R@10 drops significantly on a click-mined set
- **THEN** the report SHALL state "hybrid: not recommended" naming the regressed set
