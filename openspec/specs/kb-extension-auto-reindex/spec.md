# kb-extension-auto-reindex Specification

## Purpose

The standalone kb extension keeps the local markdown knowledge base fresh without any explicit indexing step. A single `tool_result` hook observes write/edit tool activity and runs two jobs: Job 1 debounces a content-hash-gated incremental reindex whenever a `.md` file is edited (and acknowledges the rows of an edited `AGENTS.md`), and Job 2 emits an opt-in, deduped nudge to update the nearest `AGENTS.md` row when a non-md source file is edited. The pull tools (`kb_search`, `kb_neighbors`, `kb_get`) additionally self-populate a cold index and run a freshness reindex, and all paths self-heal when a working directory is removed from disk.

## Requirements

### Requirement: Debounced hash-gated reindex on markdown edit

Job 1 SHALL run whenever a `write`, `edit`, or `bash` tool result carries a path ending in `.md`, `.mdx`, or `.markdown`, scheduling a debounced incremental reindex whose actual re-chunking is gated by file content changes.

#### Scenario: Markdown edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.md`/`.mdx`/`.markdown` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd
- **AND** the reindex fires after the debounce window (default 800 ms) elapses with no further edit

#### Scenario: Rapid successive edits collapse to one reindex
- **WHEN** multiple markdown edits arrive for the same cwd within the debounce window
- **THEN** each new edit clears the pending timer and reschedules
- **AND** only a single reindex runs after the last edit, keyed per cwd

#### Scenario: Unchanged content skips re-chunking
- **WHEN** the debounced reindex walks the sources
- **THEN** the incremental indexer compares each file's mtime then sha256 hash
- **AND** files whose hash is unchanged are not re-chunked

#### Scenario: A bash tool result with no path is ignored
- **WHEN** a `bash` tool result carries a `command` but no `path`
- **THEN** no reindex is scheduled (bash commands are not parsed for edits)

#### Scenario: Reindex failure is swallowed
- **WHEN** the debounced reindex rejects
- **THEN** the error is logged as a warning and does not crash the session

### Requirement: AGENTS.md row acknowledgement

Editing an `AGENTS.md` (or `CLAUDE.md`) SHALL acknowledge the rows it documents, clearing their staleness flags so a later non-md edit of those files does not fire a spurious stale nudge.

#### Scenario: Editing an AGENTS.md refreshes row hashes
- **WHEN** an edited markdown path's basename is `AGENTS.md` or `CLAUDE.md`
- **THEN** each row path parsed from that file is resolved relative to the AGENTS.md directory (with a project-root fallback)
- **AND** every existing resolved file's current sha256 is recorded in `.pi/dashboard/kb/dox-staleness.json` keyed by cwd-relative path

#### Scenario: A non-existent AGENTS.md is a no-op
- **WHEN** acknowledgement runs for a path that does not exist on disk
- **THEN** the staleness map is left unchanged

### Requirement: Opt-in deduped DOX nudge on non-md edit

Job 2 SHALL, only when DOX enforcement is enabled, emit at most one nudge per edited non-md path advising the agent to update the nearest `AGENTS.md` row (or bootstrap a tree when none covers the path).

#### Scenario: DOX enforcement disabled skips the nudge
- **WHEN** a non-md source file is edited and DOX enforcement is off
- **THEN** no nudge is sent

#### Scenario: DOX enforcement enabled by env override
- **WHEN** the environment variable `KB_DOX_ENFORCEMENT` equals `1`
- **THEN** DOX enforcement is on regardless of loaded config

#### Scenario: Edited file missing a row nudges to add one
- **WHEN** DOX enforcement is on and the edited file is not documented by any row in the nearest `AGENTS.md`
- **THEN** a nudge is sent telling the agent to add its row to that AGENTS.md

#### Scenario: Edited file with no covering tree nudges to init
- **WHEN** DOX enforcement is on and no `AGENTS.md` chain covers the edited path
- **THEN** a nudge is sent advising `kb dox init` to bootstrap a DOX tree

#### Scenario: Documented file with changed hash nudges stale
- **WHEN** DOX enforcement is on, the edited file has a row, and its recorded staleness hash differs from its current on-disk hash
- **THEN** a nudge is sent telling the agent the row is stale

#### Scenario: Documented file with matching hash sends nothing
- **WHEN** DOX enforcement is on, the edited file has a row, and no staleness mismatch exists
- **THEN** no nudge is sent

#### Scenario: One nudge per path per session
- **WHEN** the same non-md path triggers a nudge decision more than once
- **THEN** only the first occurrence sends a message (deduped by `kind:path` for the session)

### Requirement: Cold-start populate and freshness reindex on pull tools

The pull tools SHALL ensure the index reflects on-disk content before returning results, populating an empty index and refreshing a warm one, while never letting an indexing failure break retrieval.

#### Scenario: kb_search reindexes before searching
- **WHEN** `kb_search` executes with a non-empty query
- **THEN** a freshness reindex is awaited before the FTS query runs
- **AND** an empty or whitespace query returns an empty result without indexing

#### Scenario: kb_neighbors and kb_get populate a cold index
- **WHEN** `kb_neighbors` or `kb_get` runs against a never-indexed cwd
- **THEN** the index is populated once (guarded by a chunk-count check) before the graph walk or chunk fetch
- **AND** a warm index performs only a count check and no walk

#### Scenario: Indexing failure falls back to the existing index
- **WHEN** the freshness reindex or cold-start populate throws
- **THEN** the failure is logged as a warning and the tool answers from the existing index

#### Scenario: Concurrent reindexes coalesce
- **WHEN** a debounce-triggered reindex and a pull-tool freshness reindex overlap for the same cwd
- **THEN** both share a single in-flight walk rather than interleaving transactions on the shared store

### Requirement: Working-directory removal self-heal

All reindex and store-open paths SHALL detect a removed cwd and refuse to recreate its store, so a removed worktree does not leave a resurrected `.pi/dashboard/kb` husk.

#### Scenario: Reindex on a removed cwd evicts and no-ops
- **WHEN** a reindex is requested for a cwd that no longer exists on disk
- **THEN** the cached store handle is closed and evicted, its debounce timer cancelled
- **AND** the reindex returns zero changes without reopening a store

#### Scenario: Opening a store for a removed cwd is refused
- **WHEN** no cached handle exists and the cwd is gone from disk
- **THEN** store construction throws rather than re-creating the `.pi/dashboard/kb` directory

#### Scenario: Session shutdown closes all stores
- **WHEN** the session shuts down
- **THEN** every cached store is closed and all pending debounce timers are cleared
