## Purpose

File-mention autocomplete: typing `@` in the chat composer opens a dropdown of matching files/directories, ranked then capped, for insertion as `@path` references.

## Requirements

### Requirement: @ trigger detection
When the user types `@` after a delimiter (space, tab, or start of input) in the chat input, the system SHALL initiate file autocomplete by sending a `list_files` request to the bridge via the server.

#### Scenario: @ at start of input
- **WHEN** the user types `@` as the first character in the input
- **THEN** the system SHALL send a `list_files` request with an empty query

#### Scenario: @ after space
- **WHEN** the user types `check @` (@ after a space)
- **THEN** the system SHALL send a `list_files` request with an empty query

#### Scenario: @ in middle of word
- **WHEN** the user types `email@` (@ not after a delimiter)
- **THEN** the system SHALL NOT trigger file autocomplete

### Requirement: Debounced file search requests
The system SHALL debounce `list_files` requests at 150ms to avoid flooding the server while the user types a query after `@`.

#### Scenario: Rapid typing after @
- **WHEN** the user types `@src/ser` rapidly (each character within 150ms)
- **THEN** the system SHALL send only one `list_files` request with query `src/ser`

#### Scenario: Pause during typing
- **WHEN** the user types `@src`, pauses 200ms, then types `/db`
- **THEN** the system SHALL send two `list_files` requests: one with `src` and one with `src/db`

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

### Requirement: File autocomplete selection
When the user selects a file from the dropdown, the system SHALL insert `@path/to/file` into the input text, replacing the `@query` prefix. A space SHALL be appended after file selections. No space SHALL be appended after directory selections.

#### Scenario: Select a file
- **WHEN** the user selects `src/server/db.ts` from the dropdown while input contains `@src/ser`
- **THEN** the input SHALL contain `@src/server/db.ts ` (with trailing space)

#### Scenario: Select a directory
- **WHEN** the user selects `src/server/` from the dropdown
- **THEN** the input SHALL contain `@src/server/` (no trailing space, allowing continued completion)

### Requirement: File dropdown keyboard navigation
The file autocomplete dropdown SHALL support keyboard navigation identical to the slash command dropdown.

#### Scenario: Arrow key navigation
- **WHEN** the file dropdown is open and the user presses ArrowDown/ArrowUp
- **THEN** the highlight SHALL move to the next/previous file entry

#### Scenario: Enter or Tab to select
- **WHEN** a file is highlighted and the user presses Enter or Tab
- **THEN** that file SHALL be selected and inserted into the input

#### Scenario: Escape to dismiss
- **WHEN** the file dropdown is open and the user presses Escape
- **THEN** the dropdown SHALL close and the input SHALL retain its current text

### Requirement: Stale results handling
When a new `files_list` response arrives, it SHALL replace any previous results. The response SHALL include the original query so the client can discard results for outdated queries.

#### Scenario: Out-of-order responses
- **WHEN** the user types `@src` then quickly `@server`, and the response for `src` arrives after `server`
- **THEN** the system SHALL discard the `src` response and only show results for `server`

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

#### Scenario: Basename match outranks path substring
- **GIVEN** files `db.ts` and `src/dbg/util.ts` and query `db`
- **WHEN** the bridge ranks matches
- **THEN** `db.ts` (basename prefix) SHALL rank above `src/dbg/util.ts` (path substring)

#### Scenario: Prefix outranks mid-string substring
- **GIVEN** files `server.ts` and `myserver.ts` and query `server`
- **WHEN** the bridge ranks matches
- **THEN** `server.ts` (basename prefix) SHALL rank above `myserver.ts` (basename substring)

#### Scenario: Shallower path wins on equal score
- **GIVEN** files `config.ts` and `a/b/config.ts` and query `config`
- **WHEN** both score equally (basename prefix)
- **THEN** `config.ts` (shallower) SHALL rank above `a/b/config.ts`

### Requirement: Bare-@ ordering surfaces top-level entries
When the query is empty (the user typed only `@`), every entry matches; the bridge SHALL order results by shallowest depth first, then alphabetically, so top-level files and directories surface ahead of deeply nested entries.

#### Scenario: Bare @ lists top-level first
- **WHEN** the user types only `@` in a repo with both top-level files and deeply nested files
- **THEN** the returned set SHALL begin with top-level entries in alphabetical order, NOT arbitrary deep files from the first-traversed subtree
