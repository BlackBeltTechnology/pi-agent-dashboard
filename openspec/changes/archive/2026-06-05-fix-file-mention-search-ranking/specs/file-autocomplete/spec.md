## MODIFIED Requirements

### Requirement: File autocomplete dropdown
When `files_list` results arrive, the system SHALL display a dropdown above the input showing matching file paths. Each entry SHALL show the filename as label and the relative path as description. Directories SHALL be shown with a trailing `/`. The bridge SHALL return a ranked, capped result set: it SHALL collect all substring matches found within a bounded traversal budget, rank them, and return at most `MAX_RESULTS` (the highest-ranked entries), rather than the first matches encountered during traversal.

#### Scenario: Results received
- **WHEN** a `files_list` response arrives with file entries
- **THEN** the dropdown SHALL display the returned entries (at most `MAX_RESULTS`) with filename and path

#### Scenario: More matches than the cap
- **WHEN** a query matches more files than `MAX_RESULTS`
- **THEN** the bridge SHALL return the `MAX_RESULTS` highest-ranked matches (cap applied AFTER ranking), NOT the first `MAX_RESULTS` encountered during traversal

#### Scenario: Deep subtree does not starve shallow matches
- **WHEN** more than `MAX_RESULTS` matches exist under one deep subdirectory AND a matching file exists at a shallow path
- **THEN** the shallow match SHALL appear in the returned set (the traversal budget is decoupled from the result cap, so the first subtree no longer exhausts the result slots)

#### Scenario: No results
- **WHEN** a `files_list` response arrives with an empty file list
- **THEN** the dropdown SHALL NOT be shown

#### Scenario: Directory entry display
- **WHEN** a result entry has `isDirectory: true`
- **THEN** the entry label SHALL include a trailing `/` (e.g., `src/`)

## ADDED Requirements

### Requirement: Slash-aware query split
When the query contains `/`, the bridge SHALL split it at the LAST slash: the prefix (everything up to and including that slash) SHALL filter candidates to paths containing that prefix, and the suffix (leaf) SHALL be ranked as a basename query within that scope. A query without a slash SHALL use the whole query as the leaf with no prefix filter.

#### Scenario: Drilling into a directory ranks the leaf as a basename
- **GIVEN** files `x/db/conn.ts`, `x/db/proto.co`, and `other/co.ts`, and query `x/db/co`
- **WHEN** the bridge searches
- **THEN** results SHALL be limited to paths containing `x/db/` (so `other/co.ts` is excluded) AND `x/db/conn.ts` (basename prefix `co`) SHALL rank above `x/db/proto.co` (basename substring)

#### Scenario: Bare directory query surfaces the directory and its contents
- **GIVEN** a directory `x/db/` containing `conn.ts` and `schema.sql`, and query `x/db`
- **WHEN** the bridge searches
- **THEN** the result set SHALL include the directory entry `x/db/` and its contained files (the directory's contents appear under the path)

#### Scenario: Trailing-slash query lists directory contents
- **GIVEN** query `x/db/` (trailing slash, empty leaf)
- **WHEN** the bridge searches
- **THEN** every candidate whose path contains `x/db/` SHALL match, ordered by shallowest depth then alphabetically (directory-listing semantics)

### Requirement: File match ranking
The bridge SHALL rank file matches by relevance before applying the result cap. Ranking tiers, highest first, score the leaf query against the candidate basename: (1) exact basename match, (2) basename starts with the leaf, (3) basename contains the leaf, (4) path contains the leaf (fallback). Ties SHALL be broken by shallower path depth, then shorter path length, then alphabetical path order, yielding a deterministic order.

#### Scenario: Exact basename outranks substring
- **GIVEN** files `db.ts` and `src/dbg/util.ts` and query `db`
- **WHEN** the bridge ranks matches
- **THEN** `db.ts` (exact basename) SHALL rank above `src/dbg/util.ts` (path substring)

#### Scenario: Prefix outranks mid-string substring
- **GIVEN** files `server.ts` and `myserver.ts` and query `server`
- **WHEN** the bridge ranks matches
- **THEN** `server.ts` (basename prefix) SHALL rank above `myserver.ts` (basename substring)

#### Scenario: Shallower path wins on equal score
- **GIVEN** files `config.ts` and `a/b/config.ts` and query `config`
- **WHEN** both score as exact basename matches
- **THEN** `config.ts` (shallower) SHALL rank above `a/b/config.ts`

### Requirement: Bare-@ ordering surfaces top-level entries
When the query is empty (the user typed only `@`), every entry matches; the bridge SHALL order results by shallowest depth first, then alphabetically, so top-level files and directories surface ahead of deeply nested entries.

#### Scenario: Bare @ lists top-level first
- **WHEN** the user types only `@` in a repo with both top-level files and deeply nested files
- **THEN** the returned set SHALL begin with top-level entries in alphabetical order, NOT arbitrary deep files from the first-traversed subtree
