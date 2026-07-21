# kb-file-index-migration Specification

## Purpose
One-off deterministic migration that re-homes the purposes from `docs/file-index-*.md` splits into a per-directory `AGENTS.md` tree across the `packages/` source tree. Files covered by a legacy row carry their purpose verbatim; files with no covering row are authored fresh from source by read-only `@fast` subagents, gated by structural validation and a grounding check, and written idempotently with resumable checkpoints.

## Requirements

### Requirement: Legacy file-index parsing and merge
The migration SHALL parse each `docs/file-index-*.md` split into a path → purpose index, extracting embedded `See change:` ids, and merge all splits into one index where later splits override earlier entries for the same path.

#### Scenario: Table row parsed into a purpose entry
- **WHEN** a line matches the table-row shape `` | `<path>` | <purpose> | ``
- **THEN** the path (trimmed) maps to its verbatim purpose column
- **AND** every `See change: <id>` occurrence in the purpose is collected into the entry's change-id list

#### Scenario: Header and pointer rows skipped
- **WHEN** a row's path column is the literal `File` or its purpose column is empty
- **THEN** the row is not added to the index

#### Scenario: Splits merged with last-wins
- **WHEN** multiple split texts are merged
- **THEN** all rows combine into one index and a duplicate path takes the purpose from the later split

### Requirement: Directory planning and tier classification
The migration SHALL enumerate source files under `packages/`, group them by directory, join each file against the parsed index, and classify each directory as Tier 0 (all files covered by an index row) or Tier 1 (at least one uncovered file).

#### Scenario: Covered file classified as hit
- **WHEN** an enumerated file's repo-relative path exists in the index
- **THEN** the file entry status is `hit` and carries the index purpose verbatim

#### Scenario: Uncovered file classified as miss
- **WHEN** an enumerated file's path has no index row
- **THEN** the file entry status is `miss` and carries no purpose

#### Scenario: Directory tier derived from its files
- **WHEN** every file in a directory is a `hit`
- **THEN** the directory plan tier is 0
- **AND** if any file is a `miss` the directory plan tier is 1

#### Scenario: Deterministic ordering
- **WHEN** plans are produced
- **THEN** files within a directory are ordered by basename and directories are ordered by path, both alphabetically

#### Scenario: Scope limited to packages tree
- **WHEN** directory groups are built for the migration
- **THEN** only directories whose path begins with `packages/` are planned

### Requirement: Tier-1 subagent authoring
The migration SHALL batch uncovered (miss) files under size limits, produce a read-only `@fast` subagent prompt per batch, parse the subagent reply into per-file purposes, and fold recorded purposes into migration state.

#### Scenario: Miss files batched under limits
- **WHEN** miss files are batched
- **THEN** each batch holds at most the max-miss files (default 20) and at most the max-dirs directories (default 8)
- **AND** a single directory with more misses than the max splits into sequential same-directory batches

#### Scenario: Read-only authoring prompt emitted
- **WHEN** a batch prompt is generated
- **THEN** it lists each file's exact repo-relative path, mandates Read-only behavior (no writes/edits), requires one caveman-style table row per file, and forbids inventing a `See change:` annotation

#### Scenario: Batch reply parsed tolerantly
- **WHEN** a subagent reply is parsed
- **THEN** each `` | `<path>` | <purpose> `` line yields a path → purpose mapping, tolerating a missing trailing pipe, and rows with empty purpose are dropped

#### Scenario: Recorded purposes folded into state
- **WHEN** a parsed reply is recorded against a batch
- **THEN** each miss file with a returned purpose is stored under `state.authored[dir][base]` and files with no returned purpose are reported as missing

### Requirement: Structural validation and grounding gate
The migration SHALL validate authored rows structurally and run a grounding check on each authored miss purpose before any write, treating structural failure as blocking and reporting ungrounded identifiers.

#### Scenario: Structural validation enforces one row per file
- **WHEN** authored rows are validated against a plan
- **THEN** it fails on a duplicate row, a missing row, an empty purpose, an unexpected row, or a `hit` purpose that differs from the index purpose

#### Scenario: Grounding rejects hallucinated identifiers
- **WHEN** an authored purpose contains a backticked span with significant (mixed-case or underscore) identifiers
- **THEN** each identifier not present in the file's source text and not in the known-stems allowlist is reported as ungrounded

#### Scenario: Cross-reference identifiers allowed
- **WHEN** a backticked identifier matches another source file's stem in the known-stems set
- **THEN** it is treated as grounded even if absent from the current file

### Requirement: Idempotent per-directory write
The migration SHALL assemble one directory's `AGENTS.md` from its hit purposes plus authored miss purposes, run validation and grounding, and write the file only when structural validation passes, producing byte-stable output on re-run.

#### Scenario: Directory written on passing validation
- **WHEN** a directory's assembled rows pass structural validation and dry-run is off
- **THEN** its `AGENTS.md` is rendered (path-alphabetical rows) and written, creating parent directories as needed

#### Scenario: Write blocked on structural failure
- **WHEN** structural validation fails for a directory
- **THEN** no file is written and the errors (plus any ungrounded identifiers) are returned

#### Scenario: Dry run computes without writing
- **WHEN** the write runs in dry-run mode
- **THEN** validation and grounding are computed and returned but no file is written

### Requirement: Checkpoint and resume persistence
The migration SHALL persist authored purposes, completed directories, and gaps to a JSON state file so a partial or already-migrated run resumes without re-authoring completed work.

#### Scenario: State loaded or initialized
- **WHEN** migration state is loaded
- **THEN** the persisted `migration-state.json` under `.pi/dashboard/kb` is returned if present, otherwise an empty state (no authored purposes, no done directories, no gaps)

#### Scenario: State saved for resumption
- **WHEN** state is saved
- **THEN** the state directory is created if absent and the authored map, done-directory list, and gaps are written as JSON
