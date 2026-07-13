# markdown-knowledge-base Specification

## Purpose
TBD - created by archiving change add-markdown-knowledge-base. Update Purpose after archive.
## Requirements
### Requirement: Directory-based SQLite/FTS5 index over markdown

The system SHALL build a single-file SQLite knowledge base over one or more
configured directory roots of markdown files, using an FTS5 virtual table with a
`porter unicode61` tokenizer for BM25 full-text search. The index SHALL be
directory-based (relative paths, portable), require no server and no Docker, and
SHALL NOT cap the number of indexed files by default.

#### Scenario: Index a directory of hundreds of markdown files

- **WHEN** `kb index` runs against a root containing 691 markdown files
- **THEN** all 691 files SHALL be indexed (no file-count cap applied by default)
- **AND** the index SHALL be a single SQLite file at the configured `dbPath`
- **AND** no external service or Docker container SHALL be required

#### Scenario: BM25 search returns ranked sections

- **WHEN** a caller runs `kb search "<query>"`
- **THEN** results SHALL be ranked by `bm25()` (most-relevant first)
- **AND** each result SHALL include path, heading breadcrumb, score, and a
  `snippet()` of the matched text

### Requirement: Structural (heading) chunking with breadcrumbs

The indexer SHALL split each markdown file at heading boundaries into section
chunks, SHALL carry the heading breadcrumb into the indexed body, and SHALL NOT
split inside fenced code blocks. Files with fewer than the configured minimum
headings SHALL fall back to one-row-per-file indexing.

#### Scenario: Multi-heading file splits into sections

- **WHEN** a file with multiple headings (e.g. `interceptors.md`, 26 headings)
  is indexed
- **THEN** it SHALL produce multiple section chunks, each tagged with its full
  heading breadcrumb (e.g. `Guide > Advanced Interceptor Patterns > Decoupled
  Service Creation`)

#### Scenario: Code fences are never split

- **WHEN** a section contains a fenced code block
- **THEN** the fenced block SHALL be kept intact within its section chunk
- **AND** a `#` line inside the fence SHALL NOT be treated as a heading

#### Scenario: Leaf section matches parent-only terms

- **WHEN** a leaf section's body does not contain a term present only in an
  ancestor heading
- **THEN** the chunk SHALL still match that term because the breadcrumb is
  included in the indexed body

### Requirement: Tier-1 deterministic knowledge graph

The indexer SHALL populate `nodes` and `edges` tables during the same parse
pass, deriving edges deterministically from heading nesting (`child_of`),
`[[wikilinks]]` (`links_to`), markdown links (`references`), and YAML
frontmatter (typed entities and `has_tag`). The system SHALL expose graph
traversal via recursive CTEs. No LLM-based extraction SHALL be performed.

#### Scenario: Heading nesting produces child_of edges

- **WHEN** a file with nested headings is indexed
- **THEN** each subsection node SHALL have a `child_of` edge to its parent
  section or file node

#### Scenario: Neighbor traversal

- **WHEN** a caller runs `kb neighbors "<heading_path>" --depth 2`
- **THEN** the system SHALL return nodes reachable within 2 hops via recursive
  CTE traversal

#### Scenario: Backlinks

- **WHEN** a caller runs `kb backlinks "<file>"`
- **THEN** the system SHALL return nodes whose edges point at that file (inbound)

#### Scenario: No LLM extraction

- **WHEN** the indexer builds the graph
- **THEN** it SHALL NOT call any LLM or embedding model to derive entities or
  relations

### Requirement: Content-hash incremental indexing

The indexer SHALL detect changed markdown via a layered check (mtime, then
sha256), reindex only changed files (replacing that file's chunks and edges),
purge rows for files removed from disk, and support a `--force` full rebuild.

#### Scenario: Unchanged file is skipped

- **WHEN** `kb index` re-runs and a file's mtime and sha256 are unchanged
- **THEN** that file SHALL NOT be re-read or re-chunked

#### Scenario: Changed file reindexes only itself

- **WHEN** a single markdown file's content changes and `kb index` re-runs
- **THEN** only that file's chunks and outbound edges SHALL be replaced
- **AND** inbound edges from other files SHALL be preserved

#### Scenario: Deleted file is purged

- **WHEN** a previously indexed file no longer exists on disk and `kb index`
  re-runs
- **THEN** its chunks, nodes-as-source, and edges SHALL be removed from the index

### Requirement: Near-duplicate dedup in results

The system SHALL collapse exact-content-duplicate chunks (same body hash) into a
single visible result carrying the alternates as `aka_paths`, and SHALL prefer
the higher-priority root when configured, so duplicated directory trees do not
flood top-N results.

#### Scenario: Duplicated tree returns once

- **WHEN** the same section exists under two roots (e.g. a specialized tree and a
  template tree) and a query matches it
- **THEN** a single result SHALL be returned from the higher-priority root
- **AND** the duplicate path SHALL be listed in that result's `aka_paths`

### Requirement: Lexical ranking quality (BM25F, proximity, diversity)

Search SHALL apply, by default and without any embedding model: BM25F-style
per-field weighting (heading breadcrumb and heading weighted above body),
proximity/in-order boosting, and lexical near-duplicate diversity (MMR) to
suppress redundant sections beyond exact-content dedup. Each SHALL be
individually configurable.

#### Scenario: Heading matches outrank body matches

- **WHEN** a query term appears in a section's heading and in another section's
  body only
- **THEN** the heading match SHALL rank higher (field-weighted BM25)

#### Scenario: Near-duplicate sections are diversified

- **WHEN** the top candidates include multiple highly-similar sections
- **THEN** lexical MMR SHALL reduce redundancy in the returned top-N while
  preserving the most relevant representative

### Requirement: Parent and graph context expansion

Search SHALL support returning a child hit together with its parent
section/file (small-to-big), using the stored `parent_chunk_id` and `child_of`
edges, and SHALL optionally expand results with graph neighbors/backlinks.
Parent expansion SHALL be on by default; graph expansion SHALL be opt-in.

#### Scenario: Parent context returned with a section hit

- **WHEN** `kb search --expand-parent` (or default) returns a subsection hit
- **THEN** the result SHALL include the parent section/file context

### Requirement: Optional cross-encoder reranking and query expansion

The system SHALL provide optional, config-gated, default-OFF cross-encoder
reranking of BM25 top-k candidates and optional query expansion (lexical PRF or
agent reformulation). Cross-encoder reranking SHALL NOT require a vector index.
When disabled, search SHALL run the lexical pipeline unchanged and SHALL NOT
require any reranker model dependency.

#### Scenario: Rerank off by default

- **WHEN** no rerank configuration is set
- **THEN** search SHALL NOT load a reranker model AND SHALL return BM25-ranked
  results

#### Scenario: Rerank reorders candidates when enabled

- **WHEN** rerank is enabled (config or `--rerank`)
- **THEN** the system SHALL rescore the BM25 top-k with a cross-encoder and
  return the reranked top-N
- **AND** SHALL NOT build or require a vector index

### Requirement: Retrieval-quality evaluation via golden set

The system SHALL provide a `kb eval` command that scores search against a
golden `query -> expected-section` set, reporting Precision@K, Recall@K, MRR,
and nDCG@K, so ranking changes can be measured and regressions gated.

#### Scenario: Evaluate against a golden set

- **WHEN** `kb eval --golden <file>` runs over the configured sources
- **THEN** it SHALL report Precision@K, Recall@K, MRR, and nDCG@K for the golden
  queries

#### Scenario: Paraphrase set tracks the lexical ceiling

- **WHEN** `kb eval` runs a paraphrase golden set (queries with vocabulary
  disjoint from targets)
- **THEN** it SHALL report the same metrics so the paraphrase ceiling is tracked
- **AND** enabling query expansion SHALL be able to improve paraphrase recall
  without requiring an embedding model

### Requirement: Project and global configuration layering

Configuration SHALL be read from project-level
`.pi/dashboard/knowledge_base.json` when present, otherwise from a global
defaults file. When the project file is present but a field is absent, the global
value SHALL fill that field. The default configuration SHALL apply no file-count
cap.

#### Scenario: Project config overrides global

- **WHEN** a project `.pi/dashboard/knowledge_base.json` exists
- **THEN** its values SHALL be used for the project
- **AND** any field it omits SHALL fall back to the global default

#### Scenario: Global default used when no project config

- **WHEN** no project-level config exists
- **THEN** the global defaults file SHALL be used

#### Scenario: No cap by default

- **WHEN** neither config sets a file-count cap
- **THEN** the indexer SHALL index all matching files with no cap

### Requirement: Guided configuration setup via `kb init` and a setup SKILL

The system SHALL provide a `kb init` command that scaffolds and validates a
`knowledge_base.json` configuration. It SHALL target the project file
(`.pi/dashboard/knowledge_base.json`) by default and the global file
(`~/.pi/dashboard/knowledge_base.json`) with `--global`. It SHALL write
schema-valid defaults, accept `--source <ref>` to seed `sources[]`, ensure the
DB path is gitignored, refuse to overwrite an existing config unless `--force`,
and support `--dry-run` to print the planned file without writing. The system
SHALL also ship a `kb-setup` SKILL (packaged in `packages/kb`, separate from
`kb-search`) whose trigger-shaped description fires on setup intent and whose
procedure wraps `kb init` end-to-end: detect existing config, choose
project-vs-global scope and sources, run `kb init`, satisfy trust-on-first-use
for any remote source, then run an initial `kb index` and a smoke `kb search` to
verify the index is queryable.

#### Scenario: Scaffold a project config

- **WHEN** `kb init` runs in a project with no `.pi/dashboard/knowledge_base.json`
- **THEN** it SHALL write a schema-valid config with documented defaults
- **AND** it SHALL ensure the configured `dbPath` is gitignored

#### Scenario: Global scope

- **WHEN** `kb init --global` runs
- **THEN** it SHALL write `~/.pi/dashboard/knowledge_base.json` instead of the
  project file

#### Scenario: Existing config not clobbered

- **WHEN** `kb init` runs and the target config already exists
- **THEN** it SHALL NOT overwrite it unless `--force` is given
- **AND** `--dry-run` SHALL print the planned config and write nothing

#### Scenario: Setup SKILL drives end-to-end bring-up

- **WHEN** the `kb-setup` SKILL is active and the user asks to set up the
  knowledge base
- **THEN** the agent SHALL run `kb init`, satisfy trust for any remote source,
  run `kb index`, and run a smoke `kb search` to confirm the index responds

### Requirement: LLM-facing pull retrieval, not push injection

The knowledge base SHALL be exposed to LLM agents as a pull interface the agent
explicitly invokes (a SKILL-driven CLI in Phase 1, a registered native tool in
Phase 2). The system SHALL NOT auto-inject search results into the model context
via input or pre-tool hooks.

#### Scenario: Agent retrieves on demand via SKILL

- **WHEN** the `kb-search` SKILL is active and the agent encounters an unknown
  term or decision
- **THEN** the agent SHALL invoke the `kb` search interface to retrieve ranked
  sections before answering from memory or asking the user

#### Scenario: No push auto-injection

- **WHEN** a user message or tool call occurs
- **THEN** the system SHALL NOT automatically run a search and inject its results
  into the model context

### Requirement: Index AGENTS.md and source-level markdown

The indexer SHALL optionally include `AGENTS.md`/`CLAUDE.md` files
(`indexAgentsFiles`) and `*.md` files located in source directories rather than
dedicated doc roots (`includeSourceMarkdown`). Indexed chunks SHALL carry a
`doc_type` of `doc`, `agents`, or `source-md`, and search SHALL be filterable by
`doc_type`.

#### Scenario: AGENTS.md is searchable and tagged

- **WHEN** `indexAgentsFiles` is enabled and an `AGENTS.md` exists in the sources
- **THEN** its content SHALL be indexed with `doc_type = "agents"`
- **AND** `kb search --doc-type agents` SHALL return only agents-doc chunks

#### Scenario: Source-tree markdown is included

- **WHEN** `includeSourceMarkdown` is enabled
- **THEN** `*.md` files in source directories SHALL be indexed with
  `doc_type = "source-md"`

### Requirement: Optional directory-level AGENTS.md presentation

The system SHALL provide an opt-in, default-OFF capability
(`directoryLevelAgents`) that surfaces the nearest applicable `AGENTS.md` (and
optionally `CLAUDE.md`) for a given target path — the descendant docs that pi's
native cwd-upward context loading does not surface. It SHALL support a pull mode
(a `kb agents <path>` command returning the root-to-nearest chain) and an opt-in
push mode (surface nearest on a tool call). When no `AGENTS.md` exists on the
path and `fallbackManifest` is set, it SHALL emit the KB-generated routing
manifest instead.

#### Scenario: Disabled by default

- **WHEN** `directoryLevelAgents.enabled` is not set
- **THEN** the system SHALL NOT surface or inject directory-level AGENTS.md

#### Scenario: Pull the nearest AGENTS.md chain

- **WHEN** `directoryLevelAgents` is enabled and `kb agents <path>` runs
- **THEN** it SHALL return the applicable AGENTS.md chain from root to the
  nearest ancestor/descendant doc for that path

#### Scenario: Fallback manifest when no AGENTS.md

- **WHEN** a path has no applicable AGENTS.md and `fallbackManifest` is set
- **THEN** the system SHALL return the KB-generated routing manifest instead

### Requirement: Pluggable external doc sources

Configuration SHALL accept a `sources[]` list where each source declares a
`kind` of `filesystem`, `npm`, `git`, or `https`. A `SourceResolver` SHALL
resolve each source to a local directory before indexing, so the indexer always
operates on local directories. The system SHALL implement all four resolvers.
The legacy `roots[]` form SHALL be accepted as filesystem-source sugar. The KB
SHALL only read markdown from sources and SHALL NOT execute source code.

#### Scenario: Filesystem source

- **WHEN** a source `{kind:"filesystem", ref:"<dir>"}` is configured
- **THEN** that directory SHALL be indexed directly

#### Scenario: npm source

- **WHEN** a source `{kind:"npm", ref:"npm:<pkg>", subdir:"docs"}` is configured
- **THEN** the resolver SHALL locate the installed package directory and index
  its markdown under the given subdir (plus README)
- **AND** SHALL NOT execute the package's code

#### Scenario: git source with pin

- **WHEN** a source `{kind:"git", ref:"git:<repo>", pin:"<ref>"}` is configured
- **THEN** the resolver SHALL clone or pull into the source cache, checkout the
  pinned ref, and index its markdown

#### Scenario: https source

- **WHEN** a source `{kind:"https", ref:"https://..."}` is configured
- **THEN** the resolver SHALL fetch the file or tarball into the source cache and
  index its markdown

#### Scenario: remote source dedup and priority

- **WHEN** a remote source and a local source contain the same content
- **THEN** cross-source dedup and priority SHALL apply identically to the local
  multi-root case (one visible hit, duplicate in `aka_paths`)

### Requirement: Trust-on-first-use for remote sources

The system SHALL require trust confirmation before the first fetch of any remote
source (`npm`, `git`, `https`), and SHALL record granted trust keyed by a hash
of the source spec, mirroring the worktree-init trust store. Filesystem sources
SHALL NOT require trust.

#### Scenario: First remote fetch prompts for trust

- **WHEN** a remote source is indexed for the first time and is not yet trusted
- **THEN** the system SHALL require confirmation before fetching
- **AND** SHALL record trust so subsequent indexes do not re-prompt

#### Scenario: Filesystem source needs no trust

- **WHEN** a filesystem source is indexed
- **THEN** no trust prompt SHALL be required

### Requirement: Source pinning and refresh

Sources SHALL support an optional `pin` (git ref / npm version) for
reproducibility and a `refresh` policy of `on-index`, `manual`, or a TTL. A
`kb index --refresh` invocation SHALL re-resolve refreshable remote sources.

#### Scenario: Pinned source is reproducible

- **WHEN** a git source declares `pin`
- **THEN** repeated indexes SHALL resolve to that same ref until the pin changes

#### Scenario: Manual refresh

- **WHEN** a source declares `refresh:"manual"` and `kb index --refresh` runs
- **THEN** that source SHALL be re-pulled; without `--refresh` it SHALL use the
  cached copy

### Requirement: Pluggable storage backend via KbStore abstraction

The indexing, graph, search, and delivery layers SHALL access persistence only
through a `KbStore` interface, never via direct SQLite calls. The default
backend SHALL be `better-sqlite3` + FTS5. The interface SHALL be sufficient to
implement an alternative backend (e.g. Turso Database + Tantivy FTS) without
changing the markdown parser, chunker, graph extractor, CLI, or SKILL.

#### Scenario: Engine accessed only through KbStore

- **WHEN** the chunker, graph extractor, search formatter, CLI, or SKILL persist
  or query data
- **THEN** they SHALL call `KbStore` methods
- **AND** they SHALL NOT issue SQL or reference a specific SQLite binding directly

#### Scenario: Default backend is better-sqlite3 + FTS5

- **WHEN** no alternative backend is configured
- **THEN** the system SHALL use a `better-sqlite3` + FTS5 implementation of
  `KbStore`

#### Scenario: Alternative backend is swappable

- **WHEN** an alternative `KbStore` implementation (e.g. Turso + Tantivy FTS) is
  provided
- **THEN** it SHALL be usable without modifying the parser, chunker, graph
  extractor, CLI, or SKILL

### Requirement: Background reindex and DOX row enforcement (Phase 2)

The system SHALL provide a single isolated pi extension that subscribes to the
`tool_result` event and dispatches by edited file type — one hook, two jobs.
Job 1 (active whenever the extension loads): a `write`/`edit` modifying a `.md`
file triggers a debounced, hash-gated incremental reindex. Job 2 (opt-in,
default OFF via `doxEnforcement`): a `write`/`edit` modifying a non-markdown
source file SHALL cause the extension to locate the nearest `AGENTS.md` and, when
that file has no row for the edited path OR the row's tracked source-hash is
stale, emit a single bounded, deduplicated nudge naming the edited path and the
nearest `AGENTS.md` to update. Editing an `AGENTS.md` SHALL reindex it (Job 1)
and clear the staleness flags for the rows it touched. This extension SHALL NOT
be added to the dashboard bridge extension (`src/extension/bridge.ts`).

#### Scenario: Edit triggers reindex

- **WHEN** an agent edits a `.md` file via the `write` or `edit` tool in a
  session with the extension loaded
- **THEN** the index SHALL be updated for that file without a manual `kb index`
  invocation

#### Scenario: DOX enforcement disabled by default

- **WHEN** `doxEnforcement` is not set and a non-markdown source file is edited
- **THEN** the extension SHALL NOT emit any AGENTS.md row nudge

#### Scenario: Stale or missing row is nudged once

- **WHEN** `doxEnforcement` is enabled and a source file is edited whose nearest
  `AGENTS.md` has no row for it OR a row with a stale tracked source-hash
- **THEN** the extension SHALL emit one bounded nudge naming the edited path and
  the nearest `AGENTS.md` to update
- **AND** it SHALL NOT repeat that nudge until the row is updated

#### Scenario: Updating the AGENTS.md clears the flag

- **WHEN** the agent updates the nearest `AGENTS.md` row for the edited file
- **THEN** the staleness flag SHALL clear and no further nudge SHALL fire for
  that unchanged file

#### Scenario: Treeless project points at scaffolding

- **WHEN** `doxEnforcement` is enabled and a source file is edited in a project
  with no `AGENTS.md` on the path at all
- **THEN** the single nudge SHALL point the agent at `kb dox init` instead of
  naming a row to update

#### Scenario: Isolation from bridge

- **WHEN** the reindex extension is implemented
- **THEN** its code SHALL live in a standalone extension, separate from
  `src/extension/bridge.ts`

### Requirement: DOX tree scaffolding via `kb dox init`

The system SHALL provide an on-demand `kb dox init` command that scaffolds a
hierarchy of `AGENTS.md` files on a project that lacks one, using a deterministic
placement heuristic (a package-root `AGENTS.md` always; a deeper sub-area
`AGENTS.md` for a coherent concern past a documented-file threshold; a bounded
number of rows per file). It SHALL seed each row's path column and leave the
purpose column for the LLM to author, SHALL NOT overwrite an existing
`AGENTS.md`, and SHALL support `--dry-run` to print the planned tree without
writing.

#### Scenario: Treeless project scaffolds a tree

- **WHEN** `kb dox init` runs in a project with no `AGENTS.md`
- **THEN** it SHALL create one `AGENTS.md` per chosen sub-area per the placement
  heuristic
- **AND** each documented file SHALL appear as a row with its path filled and
  its purpose left for the LLM

#### Scenario: Idempotent rerun

- **WHEN** `kb dox init` runs again after a tree already exists
- **THEN** existing `AGENTS.md` files SHALL NOT be overwritten
- **AND** only missing files or rows SHALL be added

#### Scenario: Dry run writes nothing

- **WHEN** `kb dox init --dry-run` runs
- **THEN** the planned tree SHALL be printed
- **AND** no file SHALL be created or modified

### Requirement: DOX tree health-check via `kb dox lint`

The system SHALL provide an on-demand `kb dox lint` command that audits the DOX
`AGENTS.md` tree deterministically (no LLM extraction) and reports drift: stale
rows (a row whose tracked source-hash differs from the file on disk), orphan rows
(a row whose path no longer exists), missing rows (a documented-eligible source
file in an area with no row), missing companions (a file past the configured
size/LOC threshold lacking its `<file>.agent.md`), broken pointer-map links (a
root/area pointer whose target path does not resolve), and over-threshold areas
(an `AGENTS.md` whose row count exceeds the configured cap and should sub-split).

The command SHALL resolve each row's path **relative to the directory of the
`AGENTS.md` that declares the row** (per the DOX schema "path relative to that
`AGENTS.md`"), NOT relative to the project root. When the dir-relative target does
not exist, the command SHALL fall back to resolving the path **relative to the
project root** before classifying the row as an orphan (so a sub-directory
`AGENTS.md` — e.g. `docs/AGENTS.md` — may document a root-level config file that
lives at the project root); a row is an orphan only when the file exists at
neither location. The command SHALL treat a table row as a DOX file row **only
when it appears under a `# DOX —` heading**; rows in any other table (routing, QA,
prose) SHALL be ignored.

It SHALL support `--json` for machine consumption (CI gates) and SHALL exit
non-zero when issues are found. It SHALL support `--fix` that performs only the
deterministic subset — pruning orphan rows and inserting missing **path-only**
rows — and SHALL leave purpose authoring and prose to the LLM (the same
detect-don't-write rule as `kb dox init` and the Phase-2 hook). It SHALL NOT call
any LLM or embedding model.

#### Scenario: Row path resolves relative to its AGENTS.md

- **WHEN** `kb dox lint` audits a sub-directory `AGENTS.md` whose row
  `| \`api.ts\` |` names a file that exists in that same directory
- **THEN** the row SHALL NOT be reported as an orphan
- **AND** `kb dox lint --fix` SHALL NOT remove that row

#### Scenario: Root-level config documented in a sub-dir AGENTS.md

- **WHEN** `kb dox lint` audits `docs/AGENTS.md` whose row `| \`biome.json\` |`
  names a file that exists at the **project root** (not in `docs/`)
- **THEN** the row SHALL NOT be reported as an orphan (repo-root fallback)
- **AND** `kb dox lint --fix` SHALL NOT remove that row

#### Scenario: Non-DOX table rows are ignored

- **WHEN** `kb dox lint` audits an `AGENTS.md` containing a table under a
  non-`DOX —` heading (e.g. a routing table with `| \`Explore\` |`) or a glob
  cell (`| \`qa/packer/*.pkr.hcl\` |`)
- **THEN** those rows SHALL NOT be parsed as DOX file rows
- **AND** they SHALL NOT be reported as orphans

#### Scenario: Report drift

- **WHEN** `kb dox lint` runs over a project whose DOX tree has a stale row, an
  orphan row, and a missing row
- **THEN** it SHALL report each issue with its category, the AGENTS.md file, and
  the affected path
- **AND** it SHALL exit non-zero

#### Scenario: Clean tree passes

- **WHEN** `kb dox lint` runs over a DOX tree with no detected issues
- **THEN** it SHALL report no issues AND exit zero

#### Scenario: JSON output for CI

- **WHEN** `kb dox lint --json` runs
- **THEN** it SHALL emit the issue list as machine-readable JSON

#### Scenario: Deterministic fix only

- **WHEN** `kb dox lint --fix` runs on a tree with orphan rows and missing rows
- **THEN** it SHALL remove the orphan rows and insert missing rows with the path
  filled and the purpose left for the LLM
- **AND** it SHALL NOT author or alter any purpose text

#### Scenario: No LLM extraction

- **WHEN** `kb dox lint` runs
- **THEN** it SHALL NOT call any LLM or embedding model to derive its findings

### Requirement: kb index is atomic on failure

A `kb index` run SHALL NOT leave a committed database file at `dbPath` when the run fails
before completing successfully. A file present at `dbPath` after `kb index` SHALL mean a
successful index ran.

The store is opened with `CREATE TABLE IF NOT EXISTS`, so merely opening it writes an empty
schema to disk. To preserve the "file exists ⟺ successfully indexed" invariant, a run that
had to create the database (no prior `dbPath`) SHALL build into a temporary path
(`<dbPath>.tmp-<pid>`) and `rename()` onto `dbPath` only after the index resolves — so a
crash, OOM, or SIGKILL leaves only the temporary orphan and never a committed `dbPath`. A
create-then-`close()`+unlink()-on-failure variant SHALL NOT be used: its cleanup does not run
under uncatchable termination (OOM/SIGKILL), which would leave exactly the husk this
requirement eliminates. On a clean finalize the WAL SHALL be checkpointed and the store
closed before the `rename` (or all of `-wal`/`-shm` moved with it).

A run over an already-valid database SHALL index in place and leave that database valid and
queryable on failure (it may be partially updated by committed batches) — only a run that
itself created the file is responsible for removing it. A stale `<dbPath>.tmp-*` orphan from a
prior killed run SHALL be swept on the next index startup.

#### Scenario: Failed index leaves no artifact

- **WHEN** `kb index` is run and the index step throws before completion (missing source,
  interrupt, or error) on a checkout with no prior `dbPath`
- **THEN** the process SHALL exit non-zero
- **AND** there SHALL be no file at `dbPath` (no empty-schema husk)

#### Scenario: Failed incremental run preserves a valid prior index

- **WHEN** a valid populated index exists at `dbPath` and a subsequent `kb index` run fails
- **THEN** the prior index at `dbPath` SHALL remain valid and queryable (possibly partially
  updated by committed batches; a re-run completes it)

#### Scenario: Successful index commits the file

- **WHEN** `kb index` completes successfully over at least one non-empty source
- **THEN** a single SQLite file SHALL be present at `dbPath` with a non-zero chunk count

### Requirement: Missing source directory degrades, not aborts

`kb index` SHALL treat a *configured* source whose directory does not exist as a skip with a
warning, not a fatal error. A partial source set SHALL still produce a valid index over the
sources that do exist. A source supplied as an explicit `--source <dir>` argument that does
not exist SHALL still error (exit non-zero) — a missing explicit path is a user typo, not a
degrade case, and SHALL NOT silently yield an empty index.

#### Scenario: Explicit --source with a missing directory errors

- **WHEN** `kb index --source <dir>` is run and `<dir>` does not exist
- **THEN** the process SHALL exit non-zero
- **AND** there SHALL be no file left at `dbPath` (per the atomicity requirement)

#### Scenario: One missing source among several

- **WHEN** `kb index` runs with three configured sources and one source directory is absent
- **THEN** the two present sources SHALL be indexed
- **AND** a warning naming the missing source SHALL be emitted
- **AND** the process SHALL exit `0` with a non-zero chunk count

#### Scenario: All sources missing yields no husk

- **WHEN** every configured source directory is absent
- **THEN** the process SHALL exit non-zero
- **AND** there SHALL be no file left at `dbPath` (per the atomicity requirement)

