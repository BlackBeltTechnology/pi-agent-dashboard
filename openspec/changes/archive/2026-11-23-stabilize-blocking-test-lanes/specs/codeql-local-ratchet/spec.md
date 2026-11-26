## MODIFIED Requirements

### Requirement: Model pack is verified before analysis
Before analysis the script SHALL resolve the model pack offline and require, per
copied file, a resolved row count equal to the file's data rows (a presence check).
Any model-pack failure SHALL exit 2 and SHALL NOT skip.

Model-pack resolution SHALL be abandoned after `PI_CODEQL_RESOLVE_TIMEOUT_MS`
milliseconds (default 300000). That timeout SHALL be separate from the 60-second
pack-download timeout. A resolution that times out is a model-pack failure: the
script SHALL exit 2 naming the timeout and the variable. The variable SHALL be
read only on the path that uses it, after a CodeQL binary is found: a value that
is not a positive integer SHALL then exit 2 before any CodeQL command runs. When
no CodeQL binary is found, the script SHALL skip as it does today, whatever the
variable holds.

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

#### Scenario: Slow resolution within the bound succeeds
- **WHEN** `PI_CODEQL_RESOLVE_TIMEOUT_MS` is unset and model-pack resolution takes 90 seconds and reports the expected rows
- **THEN** the analysis SHALL continue

#### Scenario: Resolution timeout is an error, not a skip
- **WHEN** `PI_CODEQL_RESOLVE_TIMEOUT_MS` is 200 and model-pack resolution does not finish within it
- **THEN** the script SHALL exit 2 with a `CODEQL ERROR:` line naming `PI_CODEQL_RESOLVE_TIMEOUT_MS`
- **AND** it SHALL NOT print `CODEQL SKIPPED:`

#### Scenario: Invalid timeout value is refused
- **WHEN** a CodeQL binary is found and `PI_CODEQL_RESOLVE_TIMEOUT_MS` is `0`, `-5` or `abc`
- **THEN** the script SHALL exit 2 before running any CodeQL command

#### Scenario: A missing binary still skips with an invalid timeout value
- **WHEN** `CODEQL_BIN` is unset, no `codeql` is on `PATH`, and `PI_CODEQL_RESOLVE_TIMEOUT_MS` is `abc`
- **THEN** the script SHALL print `CODEQL SKIPPED:` and exit 0

#### Scenario: Pack download timeout still skips
- **WHEN** a pinned query pack is not cached and its download does not finish within 60 seconds
- **THEN** the script SHALL print `CODEQL SKIPPED:` and exit 0, unchanged by `PI_CODEQL_RESOLVE_TIMEOUT_MS`
