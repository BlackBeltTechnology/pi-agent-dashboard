# codeql-local-ratchet Specification

## Purpose
TBD - created by archiving change add-local-codeql-ratchet. Update Purpose after archive.

## Requirements

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

### Requirement: Local analysis runs on a content-addressed snapshot
`scripts/codeql-local.mjs` SHALL analyze the git-tracked and
untracked-but-not-ignored files of the working tree as they exist on disk,
excluding `codeql-baseline.json`, identified by a snapshot id that changes with
any content edit to those files and does not change when only the baseline
changes. It SHALL build fresh `javascript-typescript` and `actions` databases on
every run, analyze them with the code-scanning suites of the query-pack versions
recorded in the baseline and the `remote` threat model, and use `$CODEQL_BIN`
when set, else `codeql` on `PATH`. It SHALL work in a linked git worktree and
SHALL NOT modify the real index or working tree. A second concurrent run in the
same worktree SHALL exit 2; a lock left by a process that is no longer alive
SHALL be taken over.

#### Scenario: Uncommitted fix is analyzed
- **WHEN** a flagged line is fixed in the working tree but not committed and the script runs
- **THEN** the result for that line SHALL be absent

#### Scenario: Ignored build output is not analyzed
- **WHEN** a git-ignored directory (such as `node_modules` or `packages/electron/out`) contains a flagged pattern
- **THEN** no result SHALL reference it

#### Scenario: Snapshot id tracks content, not the baseline
- **WHEN** an already-modified file is edited again, and separately when only `codeql-baseline.json` is edited
- **THEN** the snapshot id SHALL change in the first case and SHALL NOT change in the second

#### Scenario: Seed run without a baseline file
- **WHEN** `codeql-baseline.json` does not exist and a snapshot is taken
- **THEN** the snapshot SHALL succeed

#### Scenario: Linked worktree, real index untouched
- **WHEN** the script snapshots a linked git worktree with staged, unstaged and untracked changes
- **THEN** the snapshot SHALL contain the working-tree content and `git status --porcelain` SHALL be identical before and after

#### Scenario: Live lock refuses
- **WHEN** the lock names a running process with the recorded start time
- **THEN** a second analysis and a `--prune` SHALL each exit 2 and leave the baseline unchanged

#### Scenario: Analysis options
- **WHEN** the script runs analysis through a `CODEQL_BIN` that records its arguments
- **THEN** each `database create` SHALL include `--overwrite` into a new run directory and each `database analyze` SHALL include the pinned suite and `--threat-model=remote` and SHALL NOT include `--download`

#### Scenario: Conflicted index
- **WHEN** the worktree index has unmerged entries
- **THEN** the script SHALL exit 2 asking to resolve conflicts first

#### Scenario: Stale lock
- **WHEN** the lock names a process id that is not running
- **THEN** a new run SHALL take over the lock and proceed

### Requirement: Unavailable CodeQL skips loudly, other failures error
When `CODEQL_BIN` is unset and no `codeql` is on `PATH`, or the pinned query
packs can neither be resolved from the local cache nor downloaded, the script
SHALL print a line starting `CODEQL SKIPPED:` naming the cause and exit 0.
Resolution from the cache SHALL NOT use the network, and analysis SHALL NOT
download packs. A `CODEQL_BIN` that is set but not executable SHALL be an error
(exit 2). When the CLI version differs from the one recorded in the baseline, it SHALL
print a line starting `CODEQL WARNING:` and continue. A pack download SHALL be
abandoned after 60 seconds per pack. Any other failure SHALL exit 2
with the failing command's error output.

#### Scenario: Binary missing
- **WHEN** `CODEQL_BIN` is unset and no `codeql` is on `PATH`
- **THEN** the script SHALL print `CODEQL SKIPPED:` and exit 0

#### Scenario: Packs unavailable offline
- **WHEN** the pinned packs are not cached and cannot be downloaded
- **THEN** the script SHALL print `CODEQL SKIPPED:` naming the pack and exit 0 without building a database

#### Scenario: Cached packs work offline
- **WHEN** the pinned packs are cached and the network is unavailable
- **THEN** the analysis SHALL complete

#### Scenario: Version mismatch
- **WHEN** the binary reports a version other than the baseline's `codeql` value
- **THEN** the script SHALL print `CODEQL WARNING:` naming both versions and still run the ratchet

#### Scenario: Extractor failure
- **WHEN** database creation exits non-zero, or `CODEQL_BIN` points to a missing file
- **THEN** the script SHALL exit 2 and print the command's stderr tail

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

### Requirement: Baseline grows only with a reason
`--check-baseline-diff <ref>` SHALL compare the working-tree baseline with the
baseline at `<ref>` without running an analysis, after validating both (an
invalid or missing working-tree baseline, or an invalid `<ref>` baseline, is
exit 2). An unresolvable `<ref>` SHALL be a hard error (exit 2). Evaluated per
rule and file, the summed count of `untriaged` entries SHALL NOT exceed the
`<ref>`'s, and an entry SHALL carry `untriaged` only if the same key carried
`untriaged` at `<ref>` with an equal or higher count; a violation SHALL exit 1.
New keys and raised counts with any other valid reason SHALL be allowed, except
with `--no-growth`, where any new key or raised count SHALL exit 1. When `<ref>`
resolves but has no baseline file, the working-tree key set and every count
SHALL equal those of the recorded last run for the current snapshot (exit 1
otherwise); without such a run the check SHALL print a line starting `SEED:`
and exit 0. Every entry whose count or reason changed, including removed
entries, SHALL be printed with its rule, file, old and new count, and old and
new reason.

#### Scenario: Accepted alert with a reason
- **WHEN** a new entry with reason `operator-authz: GET /api/x …` is added for `js/path-injection`
- **THEN** the check SHALL pass and print the entry

#### Scenario: Untriaged growth rejected
- **WHEN** an entry with reason `untriaged` is added or its count is raised
- **THEN** the check SHALL exit 1 naming the entry

#### Scenario: Untriaged total cannot grow through a changed key
- **WHEN** at `<ref>` a file has one `untriaged` entry of a rule with count 3, and in the working tree that entry is gone and two `untriaged` entries of the same rule and file have counts 2 and 2
- **THEN** the check SHALL exit 1 naming the rule and file

#### Scenario: Re-labelling to untriaged rejected
- **WHEN** an entry whose reason is `false-positive: x` at `<ref>` has reason `untriaged` in the working tree
- **THEN** the check SHALL exit 1 naming the entry

#### Scenario: Triage then accept in one branch
- **WHEN** an entry with reason `untriaged` and count 2 at `<ref>` has reason `operator-authz: GET /api/x …` and count 3 in the working tree
- **THEN** the check SHALL pass and print the old and new count and reason

#### Scenario: No growth in headless runs
- **WHEN** `--no-growth` is given and the working tree adds a key or raises a count, whatever its reason
- **THEN** the check SHALL exit 1 naming the entry

#### Scenario: Seed must equal the recorded run
- **WHEN** `<ref>` has no baseline and the working-tree baseline has an entry whose count differs from the recorded last run for the current snapshot, or lacks a key of that run
- **THEN** the check SHALL exit 1; and when no such run is recorded it SHALL print `SEED:` and exit 0

#### Scenario: Invalid baseline in the diff check
- **WHEN** the working-tree or the `<ref>` baseline has a duplicate key or an unprefixed reason
- **THEN** `--check-baseline-diff` SHALL exit 2

#### Scenario: Lowering, removal and triage always allowed
- **WHEN** an entry's count is lowered, an entry is removed, or an `untriaged` reason is replaced by a prefixed reason at the same count
- **THEN** the check SHALL pass and print each change, including removals as a count of 0

#### Scenario: Unknown ref fails closed
- **WHEN** `<ref>` does not resolve to a commit
- **THEN** the check SHALL exit 2

### Requirement: Prune, accept and seed modes
After an analysis the script SHALL record the run's snapshot id, keys, counts,
results and a hash of the canonical serialization of the baseline the run's
verdict was computed from; after `--write-baseline` the recorded hash SHALL be
that of the written baseline. JSON formatting or entry-order changes SHALL NOT
change the hash.
`--prune` SHALL lower every entry to its current count and remove
entries whose count reaches 0, never raising a count or changing a reason.
`--accept <ruleId> <file> <lineHash> --reason <text>` SHALL set a key that has
results in excess of its baseline count in the last run to its current count
with the given reason, which SHALL be a valid non-`untriaged` reason and, for
an existing entry, SHALL differ from its current reason after whitespace
normalization (trim, runs of whitespace collapsed to one space). Both SHALL refuse
(exit 2, baseline unchanged) when no run is recorded, the snapshot id changed
since it, or the baseline file no longer hashes to the recorded baseline hash
(a record without a hash SHALL be accepted with a note on stderr), SHALL be
repeatable after one run (each write re-records the baseline hash), and SHALL print the ratchet
verdict recomputed against the updated baseline, exiting 0 when no new results
remain and 1 when some do.
`--triage <ruleId> <file> <lineHash> --reason <text>` SHALL replace the reason
of an existing entry whose reason is `untriaged` with a valid non-`untriaged`
reason, leaving its count unchanged, without an analysis run but under the
lock, and SHALL refuse (exit 2) a missing key or any other entry. After its
write, `--triage` SHALL re-record the baseline hash only when a run is recorded
whose hash matches the baseline as it was before the triage.
`--prune`
SHALL print every removed or lowered entry whose reason is not `untriaged`. `--write-baseline` SHALL refuse when a baseline exists; otherwise it
SHALL run an analysis with the script's built-in default pack versions and
write a baseline whose header records the CLI and pack versions of that run
and whose entries are all current keys with reason `untriaged`. Written
baselines SHALL be sorted by file, rule id and line hash.

#### Scenario: Prune removes a fixed alert
- **WHEN** a baselined key has no current results and `--prune` runs
- **THEN** the entry SHALL be removed and every other entry SHALL be unchanged

#### Scenario: Prune reports lost reasons
- **WHEN** `--prune` removes an entry whose reason is `github-dismissed (#12, false positive): x`
- **THEN** it SHALL print that entry with its reason

#### Scenario: Prune never raises
- **WHEN** a key's current count exceeds its baseline and `--prune` runs
- **THEN** that entry's count SHALL be unchanged

#### Scenario: Several accepts after one run
- **WHEN** a run reports two new keys and `--accept` is invoked for each with reason `false-positive: constant input`
- **THEN** both SHALL be recorded with their current counts, and the second invocation SHALL print a passing verdict

#### Scenario: Accept refuses stale or invalid input
- **WHEN** `--accept` names a key without excess results, uses reason `untriaged`, an empty or unprefixed reason, the entry's current reason, or an `operator-authz:` reason on `js/request-forgery`, or a source file changed since the last run
- **THEN** the script SHALL exit non-zero and leave the baseline unchanged

#### Scenario: Triage an untriaged entry
- **WHEN** `--triage` names an entry with reason `untriaged` and reason `false-positive: constant input`
- **THEN** that entry's reason SHALL change, its count SHALL stay the same, and a following `--check-baseline-diff` SHALL pass and print the changed reason

#### Scenario: Triage refuses a triaged entry
- **WHEN** `--triage` names an entry whose reason is not `untriaged`
- **THEN** the script SHALL exit 2 and leave the baseline unchanged

#### Scenario: Seed run writes header and entries
- **WHEN** `--write-baseline` runs with no baseline present
- **THEN** the written baseline SHALL record the CLI and pack versions of the run and contain every current key with reason `untriaged`, and a following plain run SHALL pass

#### Scenario: Seed refuses to overwrite
- **WHEN** `--write-baseline` runs while `codeql-baseline.json` exists
- **THEN** it SHALL exit non-zero and leave the file unchanged

#### Scenario: Hand-edited baseline is refused
- **WHEN** an entry of the baseline file is edited by hand after an analysis run and `--accept` or `--prune` is invoked
- **THEN** the script SHALL exit 2 asking to re-run the analysis and leave the baseline unchanged

#### Scenario: Legacy run record without a hash
- **WHEN** `last-run.json` has no baseline hash
- **THEN** `--prune` and `--accept` SHALL proceed as before and print a note that the baseline binding was not checked

#### Scenario: Baseline edited during the analysis
- **WHEN** the baseline file is edited by hand while an analysis run is in progress and `--accept` or `--prune` is invoked after it
- **THEN** the script SHALL exit 2 and leave the baseline unchanged

#### Scenario: Triage between run and accept
- **WHEN** an analysis run is followed by `--triage` of an untriaged entry and then `--accept` of a new key
- **THEN** the accept SHALL succeed

#### Scenario: Triage does not launder a hand edit
- **WHEN** the baseline is edited by hand after a run, then `--triage` runs, then `--prune` runs
- **THEN** the prune SHALL exit 2 and leave the baseline unchanged

#### Scenario: Triage after a legacy run does not launder a hand edit
- **WHEN** `last-run.json` has no baseline hash, the baseline is edited by hand, then `--triage` runs
- **THEN** `last-run.json` SHALL still have no baseline hash

#### Scenario: Reformatting does not invalidate a run
- **WHEN** the baseline file's JSON formatting or entry order changes after a run and `--prune` is invoked
- **THEN** the prune SHALL proceed

#### Scenario: Prune or accept after a seed run
- **WHEN** `--write-baseline` runs and is followed by `--prune`
- **THEN** the prune SHALL proceed without the legacy note

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
