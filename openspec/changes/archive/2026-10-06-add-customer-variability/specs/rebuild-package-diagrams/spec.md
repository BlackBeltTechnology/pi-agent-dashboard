## ADDED Requirements

### Requirement: Customer variability
The skill SHALL derive per-customer variability from code-read config paths and effective variant configs: a gated feature record, deterministic evaluation per variant and customer, reachability of screens and actions, findings, exports and a catalog view.

#### Scenario: Draft from code reads
- **WHEN** `variability-draft` runs
- **THEN** it lists only config paths matched by the adapter's `configReads` in the app's code, each with its cite and its value in every effective variant

#### Scenario: Feature grounded in code
- **WHEN** a feature's condition path is not read at any of its cited lines
- **THEN** `check-variability` fails naming the feature

#### Scenario: Complete coverage
- **WHEN** `check-variability --complete` runs and a varying code-read path is neither in a feature nor in `data`
- **THEN** it fails listing the path

#### Scenario: Evaluation per customer
- **WHEN** the package is assembled
- **THEN** each feature is on, off or mixed per customer from its condition evaluated on that customer's variants, with variants the adapter's `variants` hook marks as non-production flagged `env`

#### Scenario: Reachability
- **WHEN** a feature is off for a customer
- **THEN** the screens and actions it affects are shown unreachable for that customer in the catalog

#### Scenario: Findings
- **WHEN** a feature is off in every variant, on for one customer only, or constant across all
- **THEN** it appears in `variability-findings.md` under that heading
