## MODIFIED Requirements

### Requirement: Drift lint
The `dox lint` operation SHALL scan all `AGENTS.md` files and report drift issues in the categories `stale`, `orphan`, `missing`, `missing-companion`, `broken-pointer`, `broken-ref`, and `over-threshold`, and MAY auto-correct a subset when fix mode is enabled. The `missing` category SHALL cover source files as well as markdown files, because a source file with no per-file record is unreachable through the `agents` document-type lane that retrieval depends on.

Only table rows under a `# DOX` heading are treated as file-index rows; rows under other headings are ignored.

#### Scenario: Row points to a non-existent source file
- **WHEN** a DOX row references a path that does not exist and the path does not end in `AGENTS.md`
- **THEN** an `orphan` issue is reported
- **AND** in fix mode the orphan row is pruned from the file

#### Scenario: Row points to a non-existent AGENTS.md
- **WHEN** a DOX row references a path that does not exist and ends in `AGENTS.md`
- **THEN** a `broken-pointer` issue is reported
- **AND** the row is retained even in fix mode (only orphan rows are pruned)

#### Scenario: Documented source hash drifted
- **WHEN** a row's source file exists, is tracked in the staleness sidecar, and its current SHA-256 differs from the acknowledged hash
- **THEN** a `stale` issue is reported

#### Scenario: Undocumented markdown file in an area
- **WHEN** a markdown file lives in a directory covered by an `AGENTS.md` (itself or an ancestor) and has no row
- **THEN** a `missing` issue is reported against the nearest ancestor `AGENTS.md` (deepest matching directory)
- **AND** in fix mode a blank-purpose row for that file is appended to that owner

#### Scenario: Undocumented source file in an area
- **WHEN** a source file lives in a directory covered by an `AGENTS.md` (itself or an ancestor), has no row in any ancestor `AGENTS.md`, and has no `<file>.AGENTS.md` sidecar
- **THEN** a `missing` issue is reported against the nearest ancestor `AGENTS.md`
- **AND** the same exclusions that apply to the source-file walk (declaration files, test and spec files, excluded trees) SHALL apply, so they are never reported

#### Scenario: A sidecar satisfies the source-file row requirement
- **WHEN** a source file has no row in its directory `AGENTS.md` but does have a `<file>.AGENTS.md` sidecar
- **THEN** no `missing` issue is reported for that file

#### Scenario: Source-file missing rows are separately selectable
- **WHEN** `dox lint` runs
- **THEN** source-file `missing` findings SHALL be distinguishable from markdown `missing` findings by their reported target
- **AND** the source-file arm SHALL be independently enableable, so an existing tree can adopt it without failing wholesale on first run

#### Scenario: DOX row path resolves outside its own AGENTS.md directory
- **WHEN** a DOX row path is relative and the dir-relative target (resolved against the row's own `AGENTS.md` directory) does not exist
- **THEN** the path is re-resolved against the working directory root, so a nested `AGENTS.md` may document a file living outside its own directory
- **AND** the dir-relative candidate is used only when neither the dir-relative nor the root-relative target exists (the caller then flags it `orphan`)

#### Scenario: Row prose cites a repo path that does not exist
- **WHEN** a DOX row's PURPOSE cell contains a backticked token that names a path in this repository, and that path does not resolve
- **THEN** a `broken-ref` issue is reported against the owning `AGENTS.md`
- **AND** the row is retained in fix mode (only orphan rows are pruned)

This category exists because the hash check validates the file BEHIND a row but never the paths written INSIDE it, so a directory move leaves cross-references dangling while the tree still lints clean.

#### Scenario: Path-shaped prose that is not a repo path is ignored
- **WHEN** a purpose cell contains a backticked token that is a URL route, MIME type, npm package specifier, model identifier, `~`-prefixed or absolute path, placeholder containing `<`/`>`, or a code fragment such as `get/list/remove`
- **THEN** no `broken-ref` issue is reported
- **AND** a token whose first path segment is not a real top-level entry of the working directory is likewise ignored, so prose describing another project's layout does not produce a finding

#### Scenario: References into excluded or not-yet-built trees are ignored
- **WHEN** a referenced path lies under a default-excluded tree, such as build output or a worktree directory
- **THEN** no `broken-ref` issue is reported, because absence there is expected rather than drift

#### Scenario: Large markdown file without companion
- **WHEN** a markdown file exceeds 300 lines or 15000 bytes and has no `<file>.agent.md` companion
- **THEN** a `missing-companion` issue is reported
- **AND** only markdown files are companion-checked — source files are never companion-checked
