## ADDED Requirements

### Requirement: Source-aware DOX walk

`kb dox init` SHALL scaffold a directory-level `AGENTS.md` tree over **source
files**, excluding worktree and openspec noise, placing each `AGENTS.md` in a
real directory (no invented `part-N` directories).

#### Scenario: Walk targets source, not markdown
- **WHEN** `kb dox init --dry-run` runs in a project with `.ts`/`.tsx` source and scattered `.md` docs
- **THEN** the planned rows describe source files (`.ts`/`.tsx`/`.js`/`.jsx`)
- **AND** `.d.ts`, `__tests__/`, and `*.test.*` files are excluded

#### Scenario: Worktree and openspec noise excluded
- **WHEN** `kb dox init --dry-run` runs in a repo containing `.worktrees/` and `openspec/`
- **THEN** no `AGENTS.md` is planned under `.worktrees/`, `openspec/`, or `doc-example/`

#### Scenario: Directory-level grouping, no pseudo-dirs
- **WHEN** a directory such as `src/client/components/` contains many source files
- **THEN** one `AGENTS.md` is planned at `src/client/components/AGENTS.md` (a real directory)
- **AND** no `AGENTS.md` is planned under any non-existent `part-N/` path
- **AND** rows list files relative to that `AGENTS.md`'s own directory

### Requirement: File-index purpose migration

The migration SHALL re-home authored purposes from `docs/file-index-<area>.md`
into per-directory `AGENTS.md` **verbatim**, never re-deriving text that already
exists.

#### Scenario: Existing row migrated verbatim
- **WHEN** a source file has a `docs/file-index-<area>.md` row with a purpose and a `See change:` annotation
- **THEN** that file's `AGENTS.md` row carries the same purpose text and the `See change:` annotation unchanged

#### Scenario: Annotations preserved
- **WHEN** a file-index row contains multiple `See change:` history pointers
- **THEN** all pointers survive in the migrated `AGENTS.md` row

### Requirement: Source-authored purposes for uncovered files

The migration SHALL author a caveman-style purpose from the source itself, via
parallel `@fast` subagents, for source files with no covering file-index row.

#### Scenario: Uncovered file gets a source-derived purpose
- **WHEN** a source file has no file-index row
- **THEN** a `@fast` subagent reads the source and writes a non-empty caveman-style purpose (key exports, contracts, one-line summary)
- **AND** the purpose column is not left blank

#### Scenario: All-hit directory needs no subagent
- **WHEN** every source file in a target directory has a covering file-index row
- **THEN** the orchestrator emits that directory's `AGENTS.md` rows verbatim without spawning a subagent
- **AND** the rows are byte-identical to the file-index purposes and `See change:` annotations

#### Scenario: Only gap directories spawn subagents
- **WHEN** the migration processes directories, some all-hit and some with at least one miss
- **THEN** it spawns a `@fast` subagent only for directories with at least one miss
- **AND** concurrency is bounded and subagents operate read-only over source with no shared state

#### Scenario: Malformed subagent output is retried then recorded
- **WHEN** a subagent returns output missing a row for an input file or with an altered hit purpose
- **THEN** the orchestrator retries that directory once
- **AND** on a second failure it records the directory in a gaps file and continues without writing a bad `AGENTS.md`

#### Scenario: Idempotent re-run
- **WHEN** the migration re-runs over a directory whose `AGENTS.md` already has authored rows
- **THEN** existing rows are not clobbered
- **AND** only missing rows are appended

### Requirement: Preserved searchability

After migration, tree rows SHALL be searchable via `kb_search`, tagged
`doc_type: agents`, without losing findability relative to the former
centralized splits.

#### Scenario: Tree rows searchable and better-ranked
- **WHEN** `indexAgentsFiles` is enabled and the KB is reindexed
- **THEN** `kb search --doc-type agents <term>` returns the per-directory `AGENTS.md` chunk containing that term
- **AND** a term formerly buried in a large monolithic split ranks at least as high from its tighter per-directory chunk

#### Scenario: Structural retrieval via kb agents
- **WHEN** `kb agents <deep-source-path>` is called with `directoryLevelAgents` pull mode enabled
- **THEN** it returns the root→nearest `AGENTS.md` chain for that path
