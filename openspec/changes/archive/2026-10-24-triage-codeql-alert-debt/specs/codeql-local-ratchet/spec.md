## MODIFIED Requirements

### Requirement: Local analysis runs on a content-addressed snapshot
`scripts/codeql-local.mjs` SHALL analyze the git-tracked and
untracked-but-not-ignored files of the working tree as they exist on disk,
excluding `codeql-baseline.json`, identified by a snapshot id that changes with
any content edit to those files and does not change when only the baseline
changes. It SHALL build fresh `javascript-typescript` and `actions` databases on
every run, analyze them with the code-scanning suites of the query-pack versions
recorded in the baseline and CodeQL's default threat model (no `--threat-model`
option, matching the CI workflow), and use `$CODEQL_BIN`
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
- **THEN** each `database create` SHALL include `--overwrite` into a new run directory and each `database analyze` SHALL include the pinned suite and SHALL NOT include `--download` or any `--threat-model` option

#### Scenario: Conflicted index
- **WHEN** the worktree index has unmerged entries
- **THEN** the script SHALL exit 2 asking to resolve conflicts first

#### Scenario: Stale lock
- **WHEN** the lock names a process id that is not running
- **THEN** a new run SHALL take over the lock and proceed
