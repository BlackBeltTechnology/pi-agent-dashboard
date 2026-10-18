## ADDED Requirements

### Requirement: First index in a linked worktree seeds from the main checkout
When the atomic first-index path builds a docs database over its configured sources for a cwd inside a linked git worktree, and `seedFromMainWorktree` is not `false` and the run was started with neither `--no-seed` nor an explicit `--source`, it SHALL initialise its temporary database from a consistent snapshot of the main checkout's docs database instead of starting empty, and then run its normal walk and install. Linked-worktree detection and main-checkout resolution SHALL follow `git-checkout-root-resolution`; the seed SHALL be used only when the resolved main checkout exists, is a directory other than the worktree, belongs to the same repository, and holds a non-empty docs database at the worktree's database path relative to its checkout root.

Every pass SHALL maintain, per source, the kb engine fingerprint that produced all of that source's rows: a source whose recorded fingerprint is absent or differs from the running one SHALL be forced; a forced pass SHALL clear the record before changing any of the source's rows and SHALL record the running fingerprint when the source's walk completes. Before the walk, the seeded database SHALL keep a source's rows only when the worktree configures that source and the main checkout recorded, for it, the current schema version, the index-options hash of the worktree's configuration, and the running kb engine fingerprint; rows of every other source SHALL be removed, and every kept file SHALL be compared by content rather than by modification time. After the walk, the seeded rows of every source the caller did not pass or whose walk reported it missing SHALL be removed, and graph nodes left without an owning path and without referencing edges SHALL be swept, before the install.

When a snapshot was used, the worktree has no `dox-staleness.json`, and the main checkout's file exists, parses, and carries either no version (the legacy format) or exactly the supported version, that file SHALL be copied. The main checkout's database contents SHALL NOT be modified. Each first index SHALL write one line to standard error after the walk: `[kb] seed=<main checkout path> sources=<kept>/<passed>` when seeded rows were installed, or `[kb] seed-skipped=<disabled|not-a-worktree|no-main-checkout|custom-dbpath|main-building|no-main-index|snapshot-error>` otherwise, the first applicable reason in that order. A failure while seeding or while walking a seeded database SHALL abandon the seed and rerun the first index once without a seed in the same run; a failure while copying `dox-staleness.json` SHALL be logged and SHALL NOT fail the run.

#### Scenario: Seeded first index equals a first index
- **GIVEN** a main checkout with a current docs database and a linked worktree whose tree differs by edited, added and deleted markdown files, with no two sources sharing a relative path
- **WHEN** the worktree's first index runs
- **THEN** its files, chunks, properties, nodes and edges equal those of an unseeded first index of the worktree's tree
- **AND** only the differing files were re-chunked
- **AND** the log line is `[kb] seed=<main> sources=<n>/<n>`

#### Scenario: Files only in the main checkout do not reach the worktree
- **GIVEN** the main checkout's index contains an untracked file `notes/private.md` that the worktree does not have
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no rows for `notes/private.md`

#### Scenario: Same mtime, different content is re-chunked
- **GIVEN** a worktree file whose modification time equals the main checkout's recorded one but whose content differs
- **WHEN** the worktree's seeded first index runs
- **THEN** that file is re-chunked from the worktree's content

#### Scenario: Source with a mismatched record builds from scratch
- **GIVEN** the main checkout recorded an older index-options hash for source `docs` and current records for `packages`
- **WHEN** the worktree's first index runs
- **THEN** `packages` rows come from the seed and only its differing files are re-chunked
- **AND** every `docs` file is chunked as in an unseeded first index
- **AND** the log line reports `sources=1/2`

#### Scenario: Rows from another kb engine are not kept
- **GIVEN** the main checkout's rows for a source were produced by a kb engine fingerprint different from the running one, with no schema-version change
- **WHEN** the worktree's first index runs
- **THEN** that source's seeded rows are not kept and its files are chunked as in an unseeded first index

#### Scenario: Engine change forces a source once
- **GIVEN** a docs database whose source `docs` records engine fingerprint `A`
- **WHEN** a pass runs with engine fingerprint `B` and no file content changed
- **THEN** every `docs` file is re-chunked and the source records `B`

#### Scenario: Interrupted forced pass leaves no engine record
- **GIVEN** a forced pass of source `docs` that commits some batches and is then killed
- **WHEN** the database is inspected and a worktree later seeds from it
- **THEN** `docs` carries no engine record, its rows are not kept as a seed, and the next pass forces it

#### Scenario: Unconfigured source rows are dropped
- **GIVEN** the main checkout indexes a source `extra` that the worktree's configuration does not list
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no rows under `extra`

#### Scenario: Source not walked in the worktree is dropped
- **GIVEN** a configured source indexed in the main checkout that, in the worktree's run, is missing, or is not passed by the caller because it is untrusted or unresolvable
- **WHEN** the worktree's seeded first index installs
- **THEN** the worktree database holds no seeded rows and no graph nodes for that source's files

#### Scenario: No main checkout
- **WHEN** the first index runs in a main checkout or a directory outside git
- **THEN** no snapshot is taken and the log line is `[kb] seed-skipped=not-a-worktree`
- **AND** for a linked worktree for which `git-checkout-root-resolution` yields no main checkout (for example a worktree of a bare repository), the log line is `[kb] seed-skipped=no-main-checkout`

#### Scenario: Worktree of a submodule seeds from the submodule checkout
- **GIVEN** a linked worktree of a submodule whose submodule checkout holds a current docs database
- **WHEN** the worktree's first index runs
- **THEN** it seeds from the submodule checkout's database

#### Scenario: Seeding disabled
- **WHEN** `seedFromMainWorktree` is `false`, or `kb index` runs with `--no-seed` or an explicit `--source`
- **THEN** no snapshot is taken, no `dox-staleness.json` is copied, and the log line is `[kb] seed-skipped=disabled`

#### Scenario: Custom database path
- **WHEN** the configured database path lies outside the worktree, or the run passed `--db`
- **THEN** no snapshot is taken and the log line is `[kb] seed-skipped=custom-dbpath`

#### Scenario: Main checkout has no index or is building one
- **WHEN** the main checkout has no docs database or an empty file at its path, or has none and its own first index is live
- **THEN** the worktree builds an unseeded first index and logs `seed-skipped=no-main-index` or `seed-skipped=main-building` respectively

#### Scenario: Seed failure reruns unseeded
- **WHEN** taking the snapshot, applying acceptance, or walking the seeded database fails (for example the main database is not a database)
- **THEN** no seeded rows remain, the first index reruns once without a seed in the same run, and the log line is `[kb] seed-skipped=snapshot-error`

#### Scenario: Main checkout keeps working during the snapshot
- **GIVEN** a session in the main checkout is writing to its docs database in short transactions
- **WHEN** a worktree's first index takes its snapshot
- **THEN** the main checkout's writes succeed, its database contents are not modified by the worktree's run, and the snapshot contains a committed state of it, including commits still in its write-ahead log

#### Scenario: DOX acknowledgements copied once
- **GIVEN** a seeded first index, a main checkout `dox-staleness.json` with the supported version or no version, and no worktree file
- **WHEN** the worktree's first index installs
- **THEN** the worktree has an identical `dox-staleness.json`
- **AND** an existing worktree file, an absent or corrupt main file, a main file with an unsupported version, or an unwritable target leaves the worktree file unchanged and the run succeeds
