# grammar-correction-eval Specification

## ADDED Requirements

### Requirement: Deterministic edit-level scorer

The system SHALL provide a pure, side-effect-free scorer that, given a dataset of
`(input, gold-edits)` and a system `(correctedText)`, computes edit-level Precision, Recall,
and F0.5 (β=0.5). System edits SHALL be derived by token-level alignment of `input →
correctedText`; an edit SHALL count as a true positive only when its span and correction
string match a gold edit. The scorer SHALL NOT perform network or filesystem I/O.

#### Scenario: Perfect correction scores F0.5 = 1

- **WHEN** the system `correctedText` applies exactly the gold edits and nothing else
- **THEN** precision, recall, and F0.5 SHALL each be `1.0`

#### Scenario: Spurious edit lowers precision more than recall

- **WHEN** the system makes one correct gold edit plus one edit absent from gold
- **THEN** recall SHALL be unaffected by the spurious edit
- **AND** F0.5 SHALL be penalised more than an F1 would be (precision weighted 2×)

#### Scenario: Scorer is deterministic and I/O-free

- **WHEN** the scorer runs twice on the same inputs
- **THEN** it SHALL return identical metrics and SHALL make no network or filesystem calls

### Requirement: Suggestion-level precision/recall

The system SHALL separately score the backend's own `suggestions[]` spans (each
`{ original, replacement }`) against the gold edits, independent of `correctedText`, so a
result whose apply-all text is good but whose per-suggestion panel is wrong (or vice-versa) is
distinguishable.

#### Scenario: Good text but junk suggestions

- **WHEN** `correctedText` matches the gold but `suggestions[]` contains a span that does not
  correspond to any gold edit
- **THEN** the headline (correctedText) F0.5 SHALL remain high
- **AND** the suggestion-level precision SHALL drop

### Requirement: Reference-based metrics

The system SHALL report edit-distance improvement — `dist(input, ref) − dist(output, ref)` at
token and character level — and, for multi-reference datasets (JFLEG), SHALL use the best
reference per item. A negative improvement SHALL indicate the system made the text worse.

#### Scenario: Multi-reference uses the best reference

- **WHEN** an item has multiple fluency references
- **THEN** the reported improvement SHALL be the maximum over those references

### Requirement: Over-correction rate

The system SHALL compute an over-correction rate over dataset items that carry no gold edit
(already-correct sentences): the fraction of such items where the system's `correctedText`
differs from the input.

#### Scenario: Altering a clean sentence counts as over-correction

- **WHEN** an item has no gold edits and the system returns `correctedText !== input`
- **THEN** that item SHALL be counted toward the over-correction rate

#### Scenario: No clean items yields an undefined-safe rate

- **WHEN** the dataset contains no no-edit items
- **THEN** the over-correction rate SHALL be reported as not-applicable, not a divide-by-zero

### Requirement: Datasets are loaded, not vendored

The harness SHALL load benchmark data from a user-supplied local path and SHALL support M2 and
JFLEG formats. The repository SHALL NOT contain JFLEG, BEA-2019, or CoNLL-2014 corpora; only
small synthetic fixtures for the scorer's own tests MAY be committed, clearly labelled as
fixtures.

#### Scenario: Missing dataset path fails cleanly

- **WHEN** the CLI is invoked without a readable `--dataset` path
- **THEN** it SHALL exit non-zero with a message pointing to the dataset-acquisition docs
- **AND** SHALL NOT make any model calls

### Requirement: Live run reuses the server model runtime and is cost-bounded

The live evaluation SHALL invoke `checkWithLlm` through the same OAuth/api_key-aware model
runtime the server uses (`getModelRegistry` + `streamSimple`), resolving credentials
server-side. It SHALL support `--limit` and bounded concurrency, and SHALL never log provider
credentials or raw provider error bodies.

#### Scenario: Limit caps the number of model calls

- **WHEN** `--limit 10` is passed against a larger dataset
- **THEN** at most 10 items SHALL be sent to the model

#### Scenario: Credentials are never logged

- **WHEN** a live run executes
- **THEN** no output or log line SHALL contain provider credentials or headers

### Requirement: LLM-as-judge is opt-in and non-authoritative

The harness SHALL provide an opt-in LLM-as-judge scorer, enabled only when `--judge
<provider/model>` is set. Judge scores SHALL be reported separately and SHALL NOT contribute to
any pass/fail decision. Judging SHALL be off by default.

#### Scenario: Judge off by default

- **WHEN** the CLI runs without `--judge`
- **THEN** no judge model SHALL be called and no judge scores SHALL be reported

### Requirement: Diagnostic, not a CI gate; scorer self-test without spend

The eval SHALL be a manually-invoked diagnostic (`npm run grammar:eval`) and SHALL NOT run as
part of the CI test gate. Only the pure scorer SHALL be unit-tested in CI. A `--dry-run` mode
SHALL exercise the loader + scorer with no model calls.

#### Scenario: Dry run makes no model calls

- **WHEN** the CLI runs with `--dry-run`
- **THEN** it SHALL compute scorer output over the dataset without invoking any model
- **AND** SHALL exit zero when the loader and scorer agree
