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
mockup and throwaway spike (`spike/**`, repository root only) paths (including script tests) and SHALL NOT exclude non-test
scripts outside the root `spike/` directory. Both SHALL apply the barrier-guard data extensions in
`.github/codeql/extensions/*.model.yml` to the JavaScript analysis. Default setup SHALL be disabled when advanced setup is enabled.

#### Scenario: Categories preserve dismissals
- **WHEN** the workflow's analyze step is read
- **THEN** its category SHALL be `/language:${{ matrix.language }}` and the matrix SHALL be exactly `actions`, `javascript-typescript`, `python`

#### Scenario: Both runners use the same file
- **WHEN** the workflow's init step and the local script's database-create command are inspected
- **THEN** the workflow SHALL reference `.github/codeql/codeql-config.yml` and the script SHALL derive its extractor exclusions from that file's `paths-ignore`

#### Scenario: Ignored paths produce no local results
- **WHEN** the local script analyzes a tree containing a flagged pattern only in a `__tests__` file, in a `mockups/` file and in a root `spike/` file
- **THEN** no result SHALL reference any of those files

#### Scenario: Spike glob excludes only the root spike directory
- **WHEN** the config's `paths-ignore` lists `spike/**`
- **THEN** the extractor filter SHALL contain the line `exclude:spike`, and a flagged pattern in `packages/x/spike/y.mjs` SHALL still be reported

#### Scenario: Filter lines are newline-separated
- **WHEN** the config's `paths-ignore` lists `**/__tests__/**` and `tests/**`
- **THEN** database creation SHALL receive `LGTM_INDEX_FILTERS` equal to `exclude:**/__tests__` and `exclude:tests` joined by a newline

#### Scenario: Exclusion not applied is an error
- **WHEN** an analysis returns a result whose file matches a `paths-ignore` glob
- **THEN** the script SHALL exit 2 naming the file and glob

#### Scenario: Non-test scripts stay analyzed
- **WHEN** the same flagged pattern is placed in `scripts/x.mjs` and in `scripts/__tests__/x.test.mjs`
- **THEN** a result SHALL reference `scripts/x.mjs` and none SHALL reference the test file

### Requirement: Per-alert baseline ratchet
Results SHALL be keyed by rule id, repository-relative file and
`primaryLocationLineHash` (or `-@<startLine>` with a `CODEQL WARNING:` line
when a result has none), with the file URI percent-decoded, counted per key, and compared with the committed
`codeql-baseline.json`. A key whose current count exceeds its baseline count
(absent counts as 0) SHALL fail the run with exit 1, listing each new result's
rule, file, start line and message. A missing baseline, a `version` other than
1, an entry with a missing field, a non-positive or non-integer count, a
malformed `lineHash`, a reason that is neither exactly `untriaged` nor of the
form `operator-authz: <text>`, `false-positive: <text>`, `accepted-risk: <text>`
or `github-dismissed (#<n>[, #<n>…], <reason>): <text>` with non-empty text,
positive integer alert numbers and `<reason>` one of `false positive`, `won't fix`
or `used in tests`, an
`operator-authz:` reason on a rule other than `js/path-injection`,
`js/command-line-injection` or `js/shell-command-constructed-from-input`, a
`file` with leading or trailing whitespace, or a duplicate key SHALL be a hard
error (exit 2); the script SHALL NOT adopt
current results implicitly.

#### Scenario: Dismissed reason grammar
- **WHEN** the baseline holds reasons `github-dismissed (#12, #13, won't fix): operator-authz: x`, `github-dismissed (#12, x): y` and `github-dismissed (#0, false positive): y`
- **THEN** the first SHALL be valid and the other two SHALL be a hard error (exit 2)

#### Scenario: New alert fails
- **WHEN** a result key is absent from the baseline
- **THEN** the run SHALL exit 1 and name the rule, file, line and message

#### Scenario: Count above baseline fails
- **WHEN** a key has baseline count 1 and two current results
- **THEN** the run SHALL exit 1 reporting one new result

#### Scenario: At or below baseline passes
- **WHEN** every key's current count is at or below its baseline count
- **THEN** the run SHALL exit 0

#### Scenario: Code inserted above keeps the key
- **WHEN** lines are inserted above a baselined result and the flagged line and the text after it are unchanged
- **THEN** the run SHALL still pass

#### Scenario: Result without a line hash is line-sensitive
- **WHEN** a result has no `primaryLocationLineHash`
- **THEN** it SHALL be keyed `-@<startLine>`, a `CODEQL WARNING:` line SHALL be printed, and the same result on another line SHALL count as new

#### Scenario: Missing or malformed baseline
- **WHEN** the baseline file is absent, or contains an entry with reason `because`, `operator-authz:` with nothing after it, or `github-dismissedX: y`, or a count of 0
- **THEN** the run SHALL exit 2 naming the problem

### Requirement: Machine-readable output
With `--json`, the script SHALL print exactly one JSON object on stdout with
`status` (`pass`, `new`, `skipped` or `error`), a `message` when `status` is
`skipped` or `error`, the CLI and pack `versions` (including `models`, a sha256 over
the applied model files in byte-wise sorted path order, when the model was loaded),
`newResults` (rule, file, line hash, start line, message), `staleEntries` (rule,
file, line hash, baseline and current count) and `warnings`; human-readable
lines SHALL go to stderr. Written baselines SHALL end with a newline and be
byte-identical for identical content.

#### Scenario: New alert as JSON
- **WHEN** the run finds one new result and one stale entry with `--json`
- **THEN** stdout SHALL parse as one object with `status` `new`, one `newResults` item and one `staleEntries` item

#### Scenario: Skip as JSON
- **WHEN** CodeQL is unavailable and `--json` is given
- **THEN** stdout SHALL be one object with `status` `skipped` and the exit code SHALL be 0

#### Scenario: Model digest reported
- **WHEN** a run with the model loaded is reported with `--json`
- **THEN** `versions.models` SHALL equal the sha256 of the applied model files in byte-wise sorted path order

#### Scenario: Written baseline is byte-stable
- **WHEN** the same baseline content is written twice, once from entries in a different input order
- **THEN** the two files SHALL be byte-identical and end with a newline

## ADDED Requirements

### Requirement: Model type strings name the intended package
In every `.github/codeql/extensions/*.model.yml`, a type value containing a dot SHALL
be single-quoted so that CodeQL parses the whole value as the package name; an
unquoted dotted type SHALL fail the repository's contract tests.

#### Scenario: Unquoted dotted type rejected
- **WHEN** a model file names the type `@scope/pkg/mod.js` without single quotes
- **THEN** the contract test SHALL fail naming the file and row

#### Scenario: Quoted `.js` type suppresses a guarded sink
- **WHEN** a route imports a modelled guard from `@scope/pkg/mod.js`, the model names `'@scope/pkg/mod.js'`, and a request value reaches a file-system sink only inside the guarded branch
- **THEN** the analysis SHALL NOT report that sink and SHALL report an unguarded twin


### Requirement: Local analysis loads the model files
The local script SHALL build a model pack outside the snapshot's source tree from
every `.github/codeql/extensions/*.model.yml` in the snapshot and pass it to the
`javascript-typescript` analysis only, via an additional-pack path and model-pack
selection, without `--download`.

#### Scenario: Analysis passes the pack
- **WHEN** the script runs analysis through a `CODEQL_BIN` that records its arguments
- **THEN** the `javascript-typescript` `database analyze` SHALL include an additional-packs path outside `<run>/src` and the model-pack selection, the `actions` and `python` analyses SHALL include neither, and none SHALL include `--download`

#### Scenario: Wrapper copies exactly the model files
- **WHEN** the snapshot contains `.github/codeql/extensions/a.model.yml` and `.github/codeql/extensions/AGENTS.md`
- **THEN** the generated pack SHALL contain `a.model.yml` and its manifest, SHALL NOT contain `AGENTS.md`, and the snapshot id SHALL be unchanged

#### Scenario: Modelled guard suppresses the result locally
- **WHEN** a request value reaches a file-system sink only inside a branch guarded by a modelled guard, and an unguarded twin reaches the same sink
- **THEN** the local analysis SHALL report the twin and SHALL NOT report the guarded sink

### Requirement: Model pack is verified before analysis
Before analysis the script SHALL resolve the model pack offline and require, per
copied file, a resolved row count equal to the file's data rows (a presence check).
Any model-pack failure SHALL exit 2 and SHALL NOT skip.

#### Scenario: Resolution exit code alone is not trusted
- **WHEN** model-pack resolution exits 0 but reports a row count for a copied file that differs from the file's data rows, or omits the file
- **THEN** the script SHALL exit 2 naming the model pack

#### Scenario: Uncommitted model edit is analyzed
- **WHEN** a tracked `.github/codeql/extensions/*.model.yml` has unstaged changes
- **THEN** the generated pack SHALL contain the working-tree bytes, as the snapshot does

#### Scenario: Model pack not found is an error, not a skip
- **WHEN** model-pack resolution reports that the extension pack cannot be found
- **THEN** the script SHALL exit 2 and SHALL NOT print `CODEQL SKIPPED:`

#### Scenario: Ignored model file is not applied
- **WHEN** a git-ignored `.github/codeql/extensions/x.model.yml` exists in the working tree
- **THEN** the generated pack SHALL NOT contain it

### Requirement: Mirror-dismissal mode
The script SHALL offer `--mirror-dismissal <ruleId> <file> <lineHash> --alert
<n>[,<n>…]`. When GitHub confirms every named alert (see "Mirror-dismissal
refusals"), it SHALL rewrite the entry's `operator-authz:`, `false-positive:` or
`accepted-risk:` reason to `github-dismissed (#<n>[, #<n>…], <dismissal reason>):
<original reason>`, keeping its count, under the lock and without an analysis run.

#### Scenario: Confirmed dismissal is mirrored
- **WHEN** an `operator-authz:` entry of count 2 is mirrored with `--alert 12,13`, and GitHub reports both alerts dismissed as `won't fix` for that rule and file
- **THEN** its reason SHALL become `github-dismissed (#12, #13, won't fix): operator-authz: …` and its count SHALL stay 2

#### Scenario: Fewer alerts than the count
- **WHEN** an entry of count 2 is mirrored with `--alert 12`
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

#### Scenario: Alert on another line of the same file
- **WHEN** a named alert's start line is not one the last recorded run reported for that key
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

#### Scenario: Two alerts on one line cannot cover two results
- **WHEN** the recorded run reported the key at lines 10 and 20, and alerts 12 and 13 are both at line 10
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

#### Scenario: Alert from another commit
- **WHEN** a named alert's most recent instance is from a commit other than the recorded run's commit
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

### Requirement: Mirror-dismissal refusals
`--mirror-dismissal` SHALL exit 2 with the baseline unchanged unless GitHub
confirms, for every named alert, that it is dismissed for the entry's rule and file
at the recorded run's commit, with one shared reason, and that the alerts' start
lines equal, as a multiset, the start lines the recorded run reported for the key.
A missing, unauthenticated, failing or stalled GitHub CLI SHALL refuse; a read
stalls after `PI_CODEQL_GH_TIMEOUT_MS` milliseconds (default 15000).

#### Scenario: Open alert is refused
- **WHEN** a named alert is open on GitHub
- **THEN** the script SHALL exit 2 naming the alert and the baseline SHALL be unchanged

#### Scenario: Stalled GitHub CLI is refused
- **WHEN** `PI_CODEQL_GH_TIMEOUT_MS` is 200 and the GitHub CLI does not answer within it
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

#### Scenario: Alert for another file is refused
- **WHEN** a named alert's location path differs from the entry's file
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

### Requirement: Mirror-dismissal input checks
`--mirror-dismissal` SHALL exit 2 with the baseline unchanged when the alert list
is malformed or its length differs from the entry's count, when no run with a
baseline hash is recorded for the current snapshot, when that run was not on a clean
tree (no change other than `codeql-baseline.json`, untracked files included), when
`--json`, `--reason` or another mode flag is given, or when the entry is
missing, `untriaged` or already `github-dismissed`.

#### Scenario: Untriaged or already-mirrored entry is refused
- **WHEN** the entry's reason is `untriaged` or already starts `github-dismissed (`
- **THEN** the script SHALL exit 2 and the baseline SHALL be unchanged

### Requirement: Mirror-dismissal hash binding
After a write, `--mirror-dismissal` SHALL re-record the baseline hash only when the
recorded run's hash matches the pre-mirror baseline, as `--triage` does.

#### Scenario: Mirror does not launder a hand edit
- **WHEN** a run is recorded, the baseline is then hand-edited, and a mirror succeeds
- **THEN** the recorded baseline hash SHALL NOT be re-recorded, so a following `--prune` or `--accept` refuses until a new run
