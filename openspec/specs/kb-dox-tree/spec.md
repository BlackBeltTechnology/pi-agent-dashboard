# kb-dox-tree Specification

## Purpose
The kb-dox-tree capability maintains a directory-level `AGENTS.md` navigation tree over a codebase: it scaffolds one `AGENTS.md` per source directory, audits the tree for drift against the filesystem, triages drifted rows against the git history, resolves the nearest-applicable chain of `AGENTS.md` files on a path, and synthesizes a routing manifest when none exists. It is pure-local and deterministic — it fills path columns, prunes rows, and applies externally-supplied purpose text, but never authors a row purpose itself.

## Requirements

### Requirement: Directory-level tree scaffolding
The `dox init` operation SHALL scaffold an `AGENTS.md` in every directory that holds at least one source file, and SHALL be idempotent — never clobbering an existing `AGENTS.md`, only adding missing files and missing path rows.

Source files are `.ts`/`.tsx`/`.js`/`.jsx` excluding `.d.ts` type declarations and `.test`/`.spec` tests. The walk skips `__tests__` directories and paths matching the default exclude set (e.g. `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `openspec`, `.worktrees`).

The `.pi` tree SHALL NOT be excluded wholesale. `.pi/skills/`, `.pi/agents/` and `.pi/prompts/` carry per-file DOX rows under the Documentation Update Protocol, so they SHALL be walked; only the non-source `.pi` subdirectories (`dashboard`, `npm`, `git`, `flows` — caches, the kb index, package/VCS mirrors, and flow run state) SHALL be skipped. A blanket `.pi` exclusion silently disables every lint category on that whole subtree.

#### Scenario: Documentation-bearing .pi subdirectories are walked
- **WHEN** the walk reaches `.pi/skills`, `.pi/agents`, or `.pi/prompts` (at the repo root or nested under a package)
- **THEN** the directory is traversed and any `AGENTS.md` in it participates in lint

#### Scenario: Cache and state .pi subdirectories are skipped
- **WHEN** the walk reaches `.pi/dashboard`, `.pi/npm`, `.pi/git`, or `.pi/flows`
- **THEN** the directory is skipped and contributes no issues

#### Scenario: Directory with source files has no AGENTS.md
- **WHEN** `dox init` runs and a directory containing source files has no `AGENTS.md`
- **THEN** a new `AGENTS.md` is created in that directory with a `# DOX — <relative dir>` heading
- **AND** it contains one table row per source file in the form `` | `<basename>` |  | `` with the purpose column left blank for the agent to author

#### Scenario: AGENTS.md already exists with some rows
- **WHEN** `dox init` runs and a directory's `AGENTS.md` already exists but is missing rows for some source files
- **THEN** only the missing rows are appended
- **AND** existing rows and content are left unchanged

#### Scenario: Dry run
- **WHEN** `dox init` runs in dry-run mode
- **THEN** it returns a plan listing files to create and rows to append
- **AND** no files are written to disk

### Requirement: Drift lint
The `dox lint` operation SHALL scan all `AGENTS.md` files and report drift issues in the categories `stale`, `orphan`, `missing`, `missing-companion`, `broken-pointer`, `broken-ref`, and `over-threshold`, and MAY auto-correct a subset when fix mode is enabled.

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

### Requirement: Fix-mode rewrite preserves non-orphan content
When fix mode is enabled the lint SHALL rewrite each `AGENTS.md` in place, preserving every heading line, every non-DOX line, and every DOX row whose target exists or is a broken pointer, while pruning ONLY orphan rows.

#### Scenario: Fix mode rewrites an AGENTS.md
- **WHEN** `dox lint` runs in fix mode over an `AGENTS.md` containing surviving rows, non-DOX prose, headings, and one orphan row
- **THEN** the file is rewritten keeping all surviving rows, non-DOX lines, and headings verbatim
- **AND** the orphan row is dropped
- **AND** broken-pointer rows (paths ending in `AGENTS.md` that do not exist) are kept, not pruned

### Requirement: Over-threshold split
The lint SHALL flag any `AGENTS.md` that exceeds either the row-count cap of 40 rows or the byte cap of 30000 bytes as `over-threshold`, because pi auto-injects a directory `AGENTS.md` on every turn and an oversized file bloats context.

#### Scenario: Too many rows
- **WHEN** an `AGENTS.md` has more than 40 DOX rows
- **THEN** an `over-threshold` issue is reported advising promotion of the heaviest rows to `<File>.AGENTS.md` sidecars

#### Scenario: Too many bytes
- **WHEN** an `AGENTS.md` file size exceeds 30000 bytes
- **THEN** an `over-threshold` issue is reported advising promotion of the heaviest rows to `<File>.AGENTS.md` sidecars (pull-only, so they are not auto-injected)

### Requirement: Stale-row triage against the acknowledged baseline
The `dox triage` operation SHALL, for each `stale` row, recover the commit whose blob SHA-256 equals the acknowledged hash and emit the diff from that commit as evidence, so a stale row can be judged rather than blindly re-acknowledged.

A `stale` verdict means only that the file's bytes changed since acknowledgement; it is NOT evidence the row text is wrong. A row is a one-line purpose summary and MAY legitimately omit anything a diff added.

#### Scenario: Acknowledged state is found in history
- **WHEN** a stale row's file has a commit within the scanned history window whose blob hashes to the acknowledged value
- **THEN** a work item is emitted carrying the owning `AGENTS.md`, the row path, the resolved target, the current purpose text, the baseline commit, and the diff
- **AND** the row path is resolved with the same resolver the lint uses, so triage and lint never disagree about which file a row denotes

#### Scenario: Diff spans uncommitted work
- **WHEN** the working-tree copy of the file differs from every committed state
- **THEN** the emitted diff SHALL be taken between the baseline commit and the WORKING TREE, not between the baseline commit and `HEAD`
- **AND** a row made stale purely by uncommitted edits therefore carries real evidence rather than an empty diff

#### Scenario: No acknowledged baseline is recoverable
- **WHEN** no commit in the scanned window matches the acknowledged hash, the file is untracked, or the row was never acknowledged
- **THEN** the work item SHALL report that no baseline was found together with the reason
- **AND** it SHALL NOT be given a substitute baseline, because an arbitrary commit would yield misleading evidence

#### Scenario: Applying verdicts
- **WHEN** decisions are applied
- **THEN** a rewrite verdict SHALL replace only the targeted row's purpose cell, leaving every other byte of the file unchanged
- **AND** a decision whose row cannot be located SHALL be reported as skipped rather than silently ignored
- **AND** writes SHALL occur only when write mode is explicitly requested; the default is a dry run

#### Scenario: Re-acknowledging a kept row
- **WHEN** rows are re-acknowledged
- **THEN** each target's current SHA-256 SHALL be recorded in the staleness sidecar
- **AND** targets that do not exist or are not regular files SHALL be ignored

### Requirement: Nearest-applicable agents chain
The `agents` chain resolution SHALL walk from the working directory down to the target path's directory and return every `AGENTS.md` found on the ancestor chain, ordered root→nearest.

Directory boundaries are matched path-segment-aware so a sibling directory sharing a name prefix is not treated as an ancestor. When enabled, `CLAUDE.md` files are collected alongside `AGENTS.md`.

#### Scenario: Multiple AGENTS.md on the path
- **WHEN** the target path has `AGENTS.md` files at several ancestor directories within the working directory
- **THEN** the chain returns them ordered from the root-most directory to the directory nearest the target

### Requirement: Fallback routing manifest
When no `AGENTS.md` exists anywhere on the target path and the fallback option is enabled, the capability SHALL synthesize a routing manifest listing markdown files under the target subtree as a path map.

#### Scenario: No AGENTS.md on the path
- **WHEN** the agents chain is empty and the fallback manifest option is enabled
- **THEN** a manifest is generated listing up to 50 markdown files under the target subtree by relative path
- **AND** when a KB store is provided it appends the top matching sections for the subtree
