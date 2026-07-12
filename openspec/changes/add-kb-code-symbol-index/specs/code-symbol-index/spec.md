# code-symbol-index — delta

## ADDED Requirements

### Requirement: Deterministic tree-sitter symbol extraction (no LLM)

The system SHALL extract code-symbol definitions from source files using
per-language tree-sitter tags queries and SHALL NOT invoke any LLM or embedding
model during extraction. Extraction SHALL produce, for each definition, the
symbol name, a kind (function, method, class, type, interface, constant), and a
`path:line[:col]` position. MVP languages SHALL include TypeScript/JavaScript,
Python, Go, Rust, Java, and C/C++.

#### Scenario: Extraction makes no model calls

- **WHEN** the symbol extractor runs over any source file
- **THEN** it SHALL NOT invoke any LLM or embedding model
- **AND** it SHALL derive symbols only from the tree-sitter parse tree

#### Scenario: A function definition yields a positioned symbol

- **GIVEN** a source file defining `parseConfig` at line 42
- **WHEN** the extractor runs
- **THEN** it SHALL emit a symbol with name `parseConfig`, kind `function`, and
  position `<path>:42`

### Requirement: Symbols populate the Tier-1 graph deterministically

The extractor SHALL model a symbol node as a *concept*: one `nodes` row per
`(type='symbol', bare name)`, and each definition of that name SHALL be a
distinct `defined_in` edge to its file node carrying the definition's `path:line`.
Multiple definitions of the same name (across files, or overloads) SHALL NOT
collide under `nodes.UNIQUE(type,name)` — they SHALL be represented as multiple
`defined_in` edges from the single name node. Heuristic same-name reference sites
SHALL emit `references` edges labeled as **candidate** (name-match, not resolved).

#### Scenario: Duplicate names share one node, distinct def edges

- **GIVEN** `parseConfig` is defined in both `src/config.ts` and `src/legacy.ts`
- **WHEN** both are extracted
- **THEN** a single `symbol` node named `parseConfig` SHALL exist
- **AND** two `defined_in` edges SHALL point from it to the two file nodes, each
  carrying its own `path:line`
- **AND** no `UNIQUE(type,name)` collision SHALL occur

#### Scenario: Reference edges are labeled candidate

- **WHEN** the extractor emits a `references` edge from a name-match site
- **THEN** that edge SHALL be marked candidate (unresolved), distinguishable
  from a resolved cross-reference

### Requirement: Symbols are retrievable via two pull-only surfaces

Symbols SHALL be indexed into FTS5 with `doc_type='symbol'` and SHALL be
retrievable through `kb_search`, filterable by doc type, for fuzzy discovery.
Additionally the system SHALL provide a `find_symbol(name, kind?, lang?)`
navigation surface that queries the `nodes`/`edges` graph directly (exact or
container-qualified name match, not BM25 ranking) and returns the definition
position (`path:line`) plus candidate reference sites. A symbol hit from either
surface SHALL carry the symbol name, kind, and `path:line`. Symbols SHALL NOT be
injected into any model context except as the result of an explicit `kb_search`
or `find_symbol` call (pull-not-push).

#### Scenario: Discovery search returns a positioned symbol hit

- **WHEN** `kb_search("parseConfig")` runs after indexing
- **THEN** a hit SHALL return name `parseConfig`, its kind, and `<path>:42`

#### Scenario: Navigation returns the definition deterministically

- **GIVEN** a symbol `parseConfig` defined at `src/config.ts:42`
- **WHEN** `find_symbol("parseConfig")` is called
- **THEN** its top result SHALL be the definition at `src/config.ts:42`
- **AND** it SHALL list candidate reference sites

#### Scenario: No push injection

- **WHEN** the KB is indexed with symbols and no search or navigation is issued
- **THEN** no symbol data SHALL enter any model prompt

### Requirement: Content-hash incremental symbol indexing

Symbol indexing SHALL reuse the existing `files` content-hash gate. A file whose
`sha256` is unchanged SHALL be skipped. A changed file SHALL have its symbol
nodes, outbound edges, and symbol chunks replaced. A deleted file SHALL have its
symbol nodes-as-source and outbound edges removed while inbound edges are
preserved.

#### Scenario: Unchanged file is skipped

- **WHEN** reindex runs and a source file's `sha256` is unchanged
- **THEN** its symbols SHALL NOT be re-extracted

#### Scenario: Deleted file drops its symbols

- **WHEN** a previously indexed source file is deleted and reindex runs
- **THEN** its symbol nodes and outbound edges SHALL be removed
- **AND** inbound edges from other files SHALL be preserved

### Requirement: Opt-in per-project and global configuration

Symbol indexing SHALL be disabled by default and configured via the existing
`kb` project/global config layering under a `symbols` block selecting enabled
languages, the extraction engine, and ignore globs. When disabled, the indexer
SHALL produce the same output as before the feature existed.

#### Scenario: Disabled by default is a no-op

- **WHEN** no `symbols.enabled` is set and indexing runs
- **THEN** no symbols SHALL be extracted
- **AND** the resulting index SHALL match the pre-feature output

#### Scenario: Ignore globs exclude paths

- **GIVEN** `symbols.ignore` contains `**/dist/**`
- **WHEN** indexing runs
- **THEN** no symbols SHALL be extracted from files under `dist/`

### Requirement: WASM binding, optional load, and a data-driven language registry

The extractor SHALL use the WebAssembly tree-sitter binding (`web-tree-sitter`)
so a single architecture-independent grammar artifact runs on every platform.
The binding and grammars SHALL be loaded lazily: no tree-sitter code SHALL be
imported and no grammar SHALL be loaded unless symbol indexing is enabled and a
supported source file is encountered, so `packages/kb` core remains free of a
mandatory tree-sitter runtime dependency. Supported languages SHALL be defined
by a data-driven registry mapping each language to its file extensions, grammar
artifact (bundled or lazily fetched), and optional `tags` query; a language
without a `tags` query SHALL be parse-only and SHALL yield no symbols. Adding a
language SHALL require only a registry entry plus its vendored grammar and query
assets, with no change to extractor code.

#### Scenario: Disabled indexing loads no tree-sitter runtime

- **WHEN** symbol indexing is disabled
- **THEN** the `web-tree-sitter` runtime SHALL NOT be imported or initialized

#### Scenario: A registered language without a tags query yields no symbols

- **GIVEN** a language present in the registry with no `tags` query
- **WHEN** a file of that language is indexed
- **THEN** no symbols SHALL be emitted and no error SHALL be raised

#### Scenario: Adding a language needs no extractor code change

- **WHEN** a new language is added via a registry entry plus its grammar and
  `tags` query assets
- **THEN** its definitions SHALL be extractable without modifying extractor code

### Requirement: Offline-reproducible core, integrity-gated lazy grammars

Core-tier grammar and query assets SHALL be vendored, version-pinned, and shipped
with the application so symbol indexing works fully offline and produces
reproducible output. Lazy-tier grammars (not shipped) SHALL be fetched only when
`symbols.allowDownload` is explicitly enabled; `allowDownload` SHALL default to
false. Each downloadable grammar SHALL carry a pinned SHA-256 in the registry; a
fetched artifact SHALL be verified against that hash and SHALL be refused on
mismatch; the fetch cache SHALL be content-addressed. Pinning SHALL be by hash,
not by "latest", so symbol output remains reproducible across machines and time.

#### Scenario: Default posture is offline core only

- **WHEN** `symbols.enabled` is true and `symbols.allowDownload` is not set
- **THEN** only vendored core-tier grammars SHALL be used
- **AND** no grammar SHALL be fetched over the network

#### Scenario: A grammar failing hash verification is refused

- **GIVEN** `symbols.allowDownload` is true and a lazy grammar is fetched
- **WHEN** the artifact's SHA-256 does not match the registry-pinned hash
- **THEN** it SHALL be rejected and SHALL NOT be loaded or executed

### Requirement: Symbols are scoped strictly per-root

Symbol nodes and edges SHALL be scoped to the KB root that indexed them; the
system SHALL NOT build a symbol graph spanning multiple roots or git worktrees.
Within a single root (e.g. a workspaces monorepo), multiple definitions of the
same name across packages SHALL be disambiguable: each `defined_in` edge and each
`find_symbol` result SHALL carry the definition's package/path.

#### Scenario: Cross-package hits are disambiguated within a root

- **GIVEN** `parseChunk` is defined in `packages/kb` and `packages/server`
- **WHEN** `find_symbol("parseChunk")` is called
- **THEN** each returned definition SHALL carry its package/path

#### Scenario: No cross-worktree symbol graph

- **GIVEN** a repository and a separate git worktree, each with its own KB root
- **WHEN** symbols are indexed in each
- **THEN** neither root's symbol graph SHALL include the other's symbols

### Requirement: Symbol-index freshness is observable

The system SHALL expose symbol-index health: total symbol count, stale
(unindexed-changed) file count, and last-index time, surfaced in the KB settings
panel per the existing index-health UI.

#### Scenario: Health reports counts

- **WHEN** the KB settings panel loads with symbol indexing enabled
- **THEN** it SHALL show the symbol count and the last symbol-index time
