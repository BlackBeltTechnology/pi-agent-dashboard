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
`paths-ignore` excludes test, e2e, QA, mockup, test-support fixture and
throwaway spike paths (including script tests) and SHALL NOT exclude non-test
scripts. Barrier-guard data extensions under `.github/codeql/extensions/` SHALL
be part of the shared configuration: CI SHALL load them, and the local script
SHALL load the same files. Default setup SHALL be disabled when advanced setup is enabled.

#### Scenario: Categories preserve dismissals
- **WHEN** the workflow's analyze step is read
- **THEN** its category SHALL be `/language:${{ matrix.language }}` and the matrix SHALL be exactly `actions`, `javascript-typescript`, `python`

#### Scenario: Both runners use the same file
- **WHEN** the workflow's init step and the local script's database-create command are inspected
- **THEN** the workflow SHALL reference `.github/codeql/codeql-config.yml` and the script SHALL derive its extractor exclusions from that file's `paths-ignore`

#### Scenario: Ignored paths produce no local results
- **WHEN** the local script analyzes a tree containing a flagged pattern only in a `__tests__` file, in a `mockups/` file, in a `spike/` file and in a `test-support/` file
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

#### Scenario: Modelled barrier guard suppresses on both sides
- **WHEN** a caller-supplied path reaches a file-system sink only after a call to a guard listed in a barrier-guard data extension
- **THEN** neither the CI analysis nor the local analysis SHALL report a `js/path-injection` result for that sink

## ADDED Requirements

### Requirement: Baseline reasons are mirrored on GitHub
A baseline entry whose reason is `github-dismissed (#<n>, <reason>)` SHALL
correspond to GitHub alert `<n>` dismissed with that reason. An open `develop`
alert that maps to an entry reasoned `operator-authz:`, `false-positive:` or
`accepted-risk:` SHALL be dismissed, and the entry rewritten to the
`github-dismissed (#<n>, …)` form.

#### Scenario: Triaged entry has no open alert
- **WHEN** the open `develop` alerts are listed after this change lands and the post-merge CodeQL scan completes
- **THEN** none SHALL match a baseline entry carrying `operator-authz:`, `false-positive:` or `accepted-risk:`

### Requirement: No untriaged baseline debt
No baseline entry SHALL carry the `untriaged` reason.

#### Scenario: No untriaged debt
- **WHEN** `codeql-baseline.json` is read after this change
- **THEN** no entry SHALL have reason `untriaged`
