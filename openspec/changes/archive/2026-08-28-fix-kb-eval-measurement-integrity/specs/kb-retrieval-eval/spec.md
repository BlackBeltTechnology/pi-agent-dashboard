# kb-retrieval-eval — delta

## ADDED Requirements

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
- **WHEN** `packages/kb/dist` is older than `packages/kb/src`
- **THEN** the build or CI check SHALL fail
- **AND** the failure SHALL state that the `kb` bin and the extension would otherwise run different engines
