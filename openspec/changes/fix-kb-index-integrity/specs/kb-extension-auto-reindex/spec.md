## MODIFIED Requirements

### Requirement: Debounced hash-gated reindex on markdown edit

Job 1 SHALL run whenever a `write`, `edit`, or `bash` tool result carries a path ending in `.md`, `.mdx`, `.markdown`, `.adoc`, or `.asciidoc`, scheduling a debounced incremental reindex whose actual re-chunking is gated by file content changes. Reindex eligibility and DOX-nudge eligibility SHALL be decided by independent predicates: scheduling a reindex for an AsciiDoc edit MUST NOT exempt that edit from Job 2's nudge decision. Every reindex pass SHALL index with the full option set derived from the resolved configuration (including the frontmatter facet configuration) and SHALL apply the store's per-source schema-version / options-hash gate, exactly as the `kb index` CLI does. A failure while indexing one source SHALL NOT prevent the pass from indexing the remaining sources.

#### Scenario: Markdown edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.md`/`.mdx`/`.markdown` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd
- **AND** the reindex fires after the debounce window (default 800 ms) elapses with no further edit

#### Scenario: AsciiDoc edit schedules a debounced reindex
- **WHEN** a `write` or `edit` tool result reports a path matching `.adoc`/`.asciidoc` (case-insensitive)
- **THEN** a reindex is scheduled for the edited file's cwd, identically to a markdown edit

#### Scenario: AsciiDoc edit stays nudge-eligible
- **WHEN** DOX enforcement is on and a `.adoc` file lacking a fresh AGENTS.md row is edited
- **THEN** a reindex is scheduled AND the DOX nudge for that path is still evaluated and sent

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

#### Scenario: Reindex converges a stale schema stamp
- **GIVEN** the cwd's docs database carries no current per-source record
- **WHEN** a debounced reindex runs and every source walks successfully
- **THEN** it force-reindexes those sources and records the current schema version and options hash for each

#### Scenario: One failing source does not stop the others
- **GIVEN** a cwd with two filesystem sources
- **WHEN** a reindex pass throws while indexing the first source
- **THEN** the second source is still indexed and recorded
- **AND** the first source keeps its previous record, so the next pass forces it again

#### Scenario: Reindex honours custom frontmatter facets
- **GIVEN** a configuration declaring a custom facet key
- **WHEN** a debounced reindex re-chunks a file carrying that key
- **THEN** the file's property rows include the custom facet value

### Requirement: Cold-start populate and freshness reindex on pull tools

The pull tools SHALL ensure the index reflects on-disk content before returning results, populating an empty index and refreshing a warm one, while never letting an indexing failure break retrieval. Calls that target the `git` scope SHALL NOT trigger the docs freshness reindex or cold-start populate; the `git` scope keeps its own freshness.

While the cwd's docs database does not exist and a first index by another process is live (a `<dbPath>.tmp-<pid>` whose PID names a live process), the pull tools and the debounced reindex SHALL NOT create, open-for-write or populate the docs database; the pull tools SHALL instead return the index-is-being-built indication as the single model-facing line `(index is still being built — no results available yet; retry shortly)` (followed by `[]` as the final line when `kb_search` is called with `format: "json"`). That back-off SHALL be decided before any store is constructed for that cwd, and the debounced reindex SHALL skip without logging a warning. Populating a docs database that does not exist yet SHALL build through the atomic first-index path, and that build is an indexing pass in flight for the freshness rules above; two pull tools in one process SHALL join one build.

The wait for that indexing pass SHALL be bounded by a freshness budget. The budget defaults to 1500 milliseconds and is overridable per session by the environment variable `KB_FRESHNESS_BUDGET_MS`, resolved by a single rule applied after trimming surrounding whitespace: a value consisting only of decimal digits is honoured, clamped down to a ceiling of 60000 milliseconds, with `0` meaning the tool never waits; every other value — absent, empty, negative, fractional, exponent-notation, unit-suffixed or otherwise non-digit — resolves to the default.

When the budget elapses before indexing completes, the tool SHALL answer from the index as it stands at that moment, SHALL report in its model-facing output that the answer may be stale, and the indexing pass SHALL continue to run so that its progress is available to later calls. Expiry SHALL NOT cancel, restart or duplicate the indexing pass, and an indexing failure observed after the tool has returned SHALL NOT surface as an unhandled error, including when every waiter has stopped waiting. When indexing completes before the budget elapses, no pending timer SHALL remain scheduled for that wait.

Whether an answer carries a staleness report SHALL be decided from the state of the indexing pass, not from the chunk count alone: an answer SHALL carry it when a pass for its cwd was still in flight when the tool stopped waiting, or when the pass failed; an answer SHALL NOT carry it when the pass completed (even if it produced no chunks) or when no pass was started or in flight for the call.

An indexing pass for a cwd counts as completed only when it actually walked every configured source and resolved successfully; a no-op return for a removed cwd, a warm-index skip, and a failed pass do not count. Completion state SHALL be forgotten when the cached store for that cwd is closed or evicted, so a cwd re-created at the same path is treated as never indexed.

A tool that arrives while an indexing pass for its cwd is already in flight SHALL wait on that pass under the same budget regardless of how many chunks the index already holds, so that an answer served from a partially written index is reported as possibly stale rather than presented as complete.

#### Scenario: kb_search reindexes before searching
- **WHEN** `kb_search` executes with a non-empty query and without `scope: "git"`
- **THEN** a freshness reindex is started (or an in-flight one joined) and awaited for at most the freshness budget before the FTS query runs
- **AND** the FTS query runs once the pass completes or the budget elapses, whichever is first
- **AND** an empty or whitespace query returns an empty result without indexing

#### Scenario: kb_neighbors and kb_get populate a cold index
- **WHEN** `kb_neighbors`, or `kb_get` without `scope: "git"`, runs against a never-indexed cwd
- **THEN** a population pass is started once (guarded by a chunk-count check) and awaited for at most the freshness budget before the graph walk or chunk fetch
- **AND** a warm index with no pass in flight performs only a count check and no walk
- **AND** a call arriving while a pass is in flight joins that pass under the budget even though the chunk count is no longer zero

#### Scenario: Git-scope calls skip the docs reindex
- **WHEN** `kb_search` or `kb_get` runs with `scope: "git"`
- **THEN** no docs freshness reindex or cold-start populate runs

#### Scenario: Indexing failure falls back to the existing index
- **WHEN** the freshness reindex or cold-start populate throws
- **THEN** the failure is logged as a warning and the tool answers from the existing index
- **AND** the answer is reported as possibly stale in the tool's model-facing output

#### Scenario: A rejection after every waiter stopped waiting is handled
- **WHEN** an indexing pass rejects after all callers have abandoned their wait
- **THEN** the rejection is handled and logged rather than raised as an unhandled rejection

#### Scenario: A pass completing inside the budget leaves no pending timer
- **WHEN** the indexing pass completes before the freshness budget elapses
- **THEN** the budget timer for that wait is cleared and no later wakeup fires for it

#### Scenario: Concurrent reindexes coalesce
- **WHEN** a debounce-triggered reindex and a pull-tool freshness reindex overlap for the same cwd
- **THEN** both share a single in-flight walk rather than interleaving transactions on the shared store

#### Scenario: Indexing slower than the budget answers from the existing index
- **WHEN** the indexing pass has not completed when the freshness budget elapses
- **THEN** the tool stops waiting and answers from the index as it stands
- **AND** the result reports that the index refresh is still running and the answer may be stale

#### Scenario: Settling just inside or just outside the budget
- **WHEN** the budget is 1500 ms and the indexing pass completes at 1499 ms, or at 1501 ms
- **THEN** the 1499 ms case answers without a staleness report and the 1501 ms case answers with one
- **AND** completion at exactly the budget may resolve either way (timer and settle ordering is not specified)

#### Scenario: Abandoned indexing keeps running for later callers
- **WHEN** a call returned because its freshness budget elapsed
- **THEN** the indexing pass for that cwd keeps running and is not restarted or duplicated by a subsequent call
- **AND** a subsequent call that arrives after it completes answers from the refreshed index without a staleness report

#### Scenario: Zero budget never waits
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is `0`
- **THEN** the tool answers from the index as it stands without waiting for indexing
- **AND** `kb_search` still starts (or joins) a freshness pass in the background, and its answer reports that it may be stale
- **AND** `kb_get` / `kb_neighbors` on a warm index with no pass in flight start no pass and carry no staleness report

#### Scenario: Surrounding whitespace in the budget value is ignored
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is a digits-only value with surrounding whitespace (for example ` 2000 `)
- **THEN** the effective budget is that value; a whitespace-only value resolves to the default

#### Scenario: A failed pass is reported as stale, never as still being built
- **WHEN** the indexing pass rejects before the tool answers
- **THEN** the answer carries the staleness report and is served from the existing index, even if that index is empty

#### Scenario: A digits-only budget above the ceiling clamps
- **WHEN** `KB_FRESHNESS_BUDGET_MS` consists only of decimal digits and exceeds 60000
- **THEN** the effective budget is exactly 60000 ms

#### Scenario: Any other budget value falls back to the default
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is absent, empty, negative (`-1`), fractional (`1500.5`), exponent-form (`1e3`), unit-suffixed (`1500ms`) or otherwise not digits-only
- **THEN** the effective budget is the default 1500 ms
- **AND** a negative value is treated as malformed rather than as "never wait"

#### Scenario: Completion state is forgotten when a cwd's store is evicted
- **WHEN** a cwd had a completed indexing pass, its cached store is then closed or evicted (for example after the worktree was removed), and a cwd at the same path is later queried with an empty index whose first pass has not completed within the budget
- **THEN** the tool returns the index-is-being-built indication rather than a normal empty result

#### Scenario: A no-op pass does not count as completed
- **WHEN** the reindex returns without walking (the cwd no longer exists, or a warm index skipped population)
- **THEN** that return does not mark the cwd as having completed an indexing pass

#### Scenario: Fresh answer carries no staleness report
- **WHEN** the indexing pass completes within the freshness budget
- **THEN** the result is returned without any staleness report

#### Scenario: Pull tool backs off during another process's first index
- **GIVEN** the cwd has no docs database and another live process is building `<dbPath>.tmp-<pid>`
- **WHEN** `kb_search`, `kb_get` or `kb_neighbors` runs without `scope: "git"`
- **THEN** no file is created at `dbPath` and no walk runs
- **AND** the tool returns, without raising an error, the model-facing line `(index is still being built — no results available yet; retry shortly)`

#### Scenario: Debounced reindex backs off during another process's first index
- **GIVEN** the cwd has no docs database and another live process is building `<dbPath>.tmp-<pid>`
- **WHEN** a debounced reindex fires
- **THEN** no file is created at `dbPath` and the pass is skipped without error or warning

#### Scenario: Dead build marker does not block
- **GIVEN** the cwd has no docs database and a `<dbPath>.tmp-<pid>` whose PID names no live process
- **WHEN** a pull tool runs
- **THEN** the cold-start populate proceeds as for a never-indexed cwd

#### Scenario: A pull tool's own first index is joined, not duplicated
- **GIVEN** the cwd has no docs database and no live build marker
- **WHEN** `kb_search` and `kb_get` run concurrently in one process
- **THEN** exactly one first-index build runs and neither tool returns the index-is-being-built line unless the freshness budget elapses first
