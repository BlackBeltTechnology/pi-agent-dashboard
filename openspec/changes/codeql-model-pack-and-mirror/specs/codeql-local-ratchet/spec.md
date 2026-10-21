## MODIFIED Requirements

### Requirement: CI and local CodeQL share one configuration
GitHub code scanning SHALL use advanced setup through `.github/workflows/codeql.yml`,
analyzing `actions`, `javascript-typescript` and `python` with build mode
`none` and categories exactly `/language:actions`,
`/language:javascript-typescript` and `/language:python`, on pushes to
`develop`, pull requests to `develop`, and a weekly schedule, with no dependency
install and no cache step. The workflow and the local script SHALL both take their exclusions from
`.github/codeql/codeql-config.yml` (the local script by translating each
`paths-ignore` glob into one newline-separated extractor filter line, without
network access, and failing when any result lies in an ignored path), whose
`paths-ignore` excludes test, e2e, QA,
mockup and throwaway spike (`spike/**`) paths (including script tests) and SHALL NOT exclude non-test
scripts. The shared configuration SHALL also include the model pack under
`.github/codeql/extensions/`. Default setup SHALL be disabled when advanced setup is enabled.

#### Scenario: Categories preserve dismissals
- **WHEN** the workflow's analyze step is read
- **THEN** its category SHALL be `/language:${{ matrix.language }}` and the matrix SHALL be exactly `actions`, `javascript-typescript`, `python`

#### Scenario: Both runners use the same file
- **WHEN** the workflow's init step and the local script's database-create command are inspected
- **THEN** the workflow SHALL reference `.github/codeql/codeql-config.yml` and the script SHALL derive its extractor exclusions from that file's `paths-ignore`

#### Scenario: Ignored paths produce no local results
- **WHEN** the local script analyzes a tree containing a flagged pattern only in a `__tests__` file, in a `mockups/` file and in a `spike/` file
- **THEN** no result SHALL reference any of those files

#### Scenario: Filter lines are newline-separated
- **WHEN** the config's `paths-ignore` lists `**/__tests__/**` and `tests/**`
- **THEN** database creation SHALL receive `LGTM_INDEX_FILTERS` equal to `exclude:**/__tests__` and `exclude:tests` joined by a newline

#### Scenario: Exclusion not applied is an error
- **WHEN** an analysis returns a result whose file matches a `paths-ignore` glob
- **THEN** the script SHALL exit 2 naming the file and glob

#### Scenario: Non-test scripts stay analyzed
- **WHEN** the same flagged pattern is placed in `scripts/x.mjs` and in `scripts/__tests__/x.test.mjs`
- **THEN** a result SHALL reference `scripts/x.mjs` and none SHALL reference the test file

## ADDED Requirements

### Requirement: Model pack layout
The barrier-guard data extensions SHALL live in exactly one CodeQL model pack
directory under `.github/codeql/extensions/`, with a `codeql-pack.yml` declaring a
library pack, a JavaScript extension target and its `*.model.yml` files as data
extensions. No `*.model.yml` SHALL sit outside that pack. GitHub code scanning SHALL
load the pack by auto-detection of that directory.

#### Scenario: Layout is a model pack
- **WHEN** `.github/codeql/extensions/` is read
- **THEN** it SHALL contain one directory with a `codeql-pack.yml` declaring `library: true`, an `extensionTargets` entry for `codeql/javascript-all` and a `dataExtensions` glob matching its `*.model.yml` files, and no `*.model.yml` outside it

### Requirement: Local analysis loads the model pack
The local script SHALL load the same model pack from the snapshot through an
additional-pack search path and model-pack selection, without network access. When
the pack or its dependencies cannot be resolved from the local cache, the script
SHALL skip loudly under the unavailable-CodeQL rule, naming the model pack.

#### Scenario: Local analysis passes the pack
- **WHEN** the script runs analysis through a `CODEQL_BIN` that records its arguments
- **THEN** each `database analyze` SHALL include an additional-packs path inside the run's snapshot that contains the model pack and SHALL select that pack as a model pack, and SHALL NOT include `--download`

#### Scenario: Modelled guard suppresses the result locally
- **WHEN** a request path reaches a file-system sink only inside a branch guarded by a modelled guard, and an unguarded twin reaches the same sink kind
- **THEN** the local analysis SHALL report the twin and SHALL NOT report the guarded sink

#### Scenario: Model pack unavailable offline
- **WHEN** the model pack's dependencies are not in the local pack cache and the network is unavailable
- **THEN** the script SHALL print `CODEQL SKIPPED:` naming the model pack, exit 0, and emit `status: "skipped"` under `--json`

### Requirement: Mirror-dismissal mode
The script SHALL offer `--mirror-dismissal <ruleId> <file> <lineHash> --alert
<n>[,<n>…] --dismissed-reason <false positive|won't fix|used in tests>`. It SHALL
rewrite the reason of one entry reasoned `operator-authz:`, `false-positive:` or
`accepted-risk:` to `github-dismissed (#<n>[, #<n>…], <dismissed-reason>): <original
reason text>`, keeping its count, under the lock and without an analysis run.

#### Scenario: Triaged entry is mirrored
- **WHEN** `--mirror-dismissal` names an `operator-authz:` entry of count 1 with `--alert 12 --dismissed-reason "won't fix"`
- **THEN** its reason SHALL become `github-dismissed (#12, won't fix): operator-authz: …` and its count SHALL be unchanged

### Requirement: Mirror-dismissal refusals and hash binding
`--mirror-dismissal` SHALL refuse (exit 2, baseline unchanged) a missing key, an
`untriaged` entry, an entry already in `github-dismissed` form, a number of alert
numbers different from the entry's count, and any other dismissed reason. After its
write it SHALL re-record the baseline hash only when the recorded run's hash matches
the pre-mirror baseline, as `--triage` does.

#### Scenario: Multi-count entry needs one alert per result
- **WHEN** an entry of count 2 is mirrored with `--alert 12`
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged
- **AND WHEN** it is mirrored with `--alert 12,13`
- **THEN** its reason SHALL start `github-dismissed (#12, #13, `

#### Scenario: Untriaged or already-mirrored entry is refused
- **WHEN** `--mirror-dismissal` names an entry whose reason is `untriaged` or already starts `github-dismissed (`
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

#### Scenario: Mirror does not launder a hand edit
- **WHEN** a run is recorded, the baseline is then hand-edited, and `--mirror-dismissal` runs
- **THEN** the mirror SHALL be written but the recorded baseline hash SHALL NOT be re-recorded, so a following `--prune` or `--accept` refuses until a new run

#### Scenario: Mirror keeps the diff check passing
- **WHEN** a branch only mirrors entries
- **THEN** `--check-baseline-diff` against the parent SHALL pass
